// A run as it happens, kept here. Pine retains a session's events while its sandbox
// lives; the findings and the screens a developer came for belong in this product, so
// each run is followed from the server whether or not a page is open:
//
// - a picture of the screen (a `frame` event) is saved as a file, with the page it shows;
// - a check the agent recorded (a `file` step naming checks/NN.json) is read back from
//   the work directory, and the screens saved up to that moment become its evidence;
// - when the turn ends, the run ends with it, or waits on its question.
//
// The events are read as pages from a saved cursor, so a restart carries on where the
// last process stopped and nothing is recorded twice.

import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentActivity, AgentTurn, Session } from "@pinesandbox/computer";
import type { Finding, Screen } from "@/shared/api";
import { CHECK_FILE, evidenceFor, parseCheck } from "@/shared/findings";
import { check, closeSession, session } from "./pine";
import { read, storedScreen, update } from "./store";

const LIVE = new Set(["running", "canceling"]);
/** A picture this small is a blank screen (a page that hasn't painted yet): it says nothing. */
const BLANK_BYTES = 8_000;

// One follower per run at a time, whether a route or the worker asks.
const shared = globalThis as typeof globalThis & { __following?: Set<string> };
const following = (shared.__following ??= new Set());

/** Follows a run until its turn ends, in the background. */
export function follow(run: string): void {
  if (following.has(run)) return;
  following.add(run);
  void followOnce(run)
    .catch(async (error) => {
      // The sandbox went away (it idled out, or stopped elsewhere): its run ends with it.
      if ((await check().catch(() => "running")) === "running") console.error("following a run:", error);
    })
    .finally(() => following.delete(run));
}

async function followOnce(id: string): Promise<void> {
  const target = await session(id);
  if (!target) return void (await check());
  for (;;) {
    const record = (await read()).runs.find((r) => r.id === id);
    if (!record?.turnId || !LIVE.has(record.state)) return;
    if (await readOn(target, id, record.cursor)) continue;
    // wait() returns as soon as the turn ends, and never cancels it: here it is also the pause between reads.
    const turn = await target.agent.wait(record.turnId, { timeoutMs: 1_200 });
    if (LIVE.has(turn.state)) continue;
    // The turn has ended: read what is left of its events, then record how it ended.
    let cursor = record.cursor;
    while (await readOn(target, id, cursor)) cursor = (await read()).runs.find((r) => r.id === id)?.cursor ?? cursor;
    return settle(target, id, turn);
  }
}

/** Reads the next page of the run's events into its record; false when there was nothing new. */
async function readOn(target: Session, id: string, cursor: number): Promise<boolean> {
  // Pictures make a page heavy: read a few events at a time.
  const page = await target.agent.eventsPage({ after: cursor, limit: 30 });
  if (page.nextAfter <= cursor) return false;

  const screens: Screen[] = [];
  const recorded: { n: number; at: string }[] = [];
  let doing: string | undefined;
  for (const event of page.events) {
    const at = (event.ts ?? new Date()).toISOString();
    const frame = event.frame();
    if (frame && frame.data.byteLength >= BLANK_BYTES) {
      const name = `${event.eventId}.${frame.mediaType.split("/")[1] ?? "webp"}`;
      const file = storedScreen(id, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, frame.data);
      screens.push({ name, at, caption: frame.activity ? lastAction(frame.activity) : "", url: frame.activity?.facts?.page?.url });
    }
    const step = event.activity();
    if (!step) continue;
    const check = step.facts?.files?.map((file) => CHECK_FILE.exec(file.path)).find(Boolean);
    if (check && step.state === "completed") recorded.push({ n: Number(check[1]), at });
    // The line under the screen: what a user would see it doing. Commands and files are its own business.
    else if (step.kind === "browser" && step.state !== "failed") doing = lastAction(step);
  }

  // Each check is read back the moment its file is written. All the screens of this
  // page count as taken before it only when they precede it in the stream.
  const checks = await Promise.all(recorded.map(async ({ n, at }) => ({ n, at, found: await readCheck(target, n) })));
  await update((data) => {
    const record = data.runs.find((r) => r.id === id);
    if (!record || record.cursor >= page.nextAfter) return;
    record.cursor = page.nextAfter;
    if (doing) record.doing = doing;
    record.screens.push(...screens.filter((screen) => !record.screens.some((s) => s.name === screen.name)));
    for (const { n, at, found } of checks) {
      if (!found) continue;
      const before = record.screens.filter((screen) => screen.at <= at);
      keep(record.findings, { ...found, at }, before);
      record.doing = `Recorded check ${n}: ${found.title}`;
    }
  });
  return true;
}

/** A browser step may run several actions and leaves one picture: the last action is what the picture shows. */
function lastAction(step: AgentActivity): string {
  const action = step.facts?.steps?.findLast((name) => name !== "Read the page" && name !== "Handle a prompt") ?? step.title;
  // A button's icon comes through as a private-use glyph: it isn't a word.
  return action.replace(/[\uE000-\uF8FF]\s*/g, "");
}

async function readCheck(target: Session, n: number): Promise<ReturnType<typeof parseCheck>> {
  const name = `checks/${String(n).padStart(2, "0")}.json`;
  try {
    return parseCheck(new TextDecoder().decode(await target.readFile(name)), n);
  } catch (error) {
    console.error(`reading ${name}:`, error);
    return null;
  }
}

/** Adds a finding with its screens, or replaces the one the agent recorded again. */
function keep(findings: Finding[], found: Omit<Finding, "screens" | "evidence">, saved: Screen[]): void {
  const others = findings.filter((f) => f.n !== found.n);
  const used = new Set(others.flatMap((f) => f.screens));
  const since = saved.findLastIndex((screen) => used.has(screen.name)) + 1;
  const next = { ...found, ...evidenceFor(found, saved, since) };
  findings.splice(0, findings.length, ...[...others, next].sort((a, b) => a.n - b.n));
}

/** Records how a turn ended: a question to answer, or the end of the run. */
async function settle(target: Session, id: string, turn: AgentTurn): Promise<void> {
  // A check whose file step this app didn't see is still in the work directory: the
  // turn's result names every file it left.
  const record = (await read()).runs.find((r) => r.id === id);
  const missed = (turn.result?.artifacts ?? [])
    .map((file) => CHECK_FILE.exec(file.relativePath))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter((n) => !record?.findings.some((f) => f.n === n));
  const late = await Promise.all(missed.map(async (n) => ({ n, found: await readCheck(target, n) })));

  const asking = turn.state === "needs_input";
  const at = (turn.endedAt ?? new Date()).toISOString();
  await update((data) => {
    const run = data.runs.find((r) => r.id === id);
    if (!run || run.turnId !== turn.turnId) return;
    for (const { found } of late) if (found) keep(run.findings, { ...found, at }, run.screens);
    delete run.doing;
    if (asking) {
      Object.assign(run, { state: "needs_input", question: turn.question || turn.result?.summary || "" });
      run.moments.push({ at, kind: "asked", text: run.question });
    } else {
      Object.assign(run, { state: turn.state, summary: turn.result?.summary ?? "", endedAt: at });
    }
  });
  // Everything a person came for is saved here now: the session can go.
  if (!asking) await closeSession(id);
}

