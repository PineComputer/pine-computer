// A run, from the form to Pine's agent: record it, bring the Computer up if it must,
// open a session for it, and hand the agent the target and the checks with the
// tester's rules as context. Approve, Decline, a typed reply and Stop act on the run's
// turn; the controls are in src/server/control.ts.
//
// Starting a Computer takes a while, so a run is recorded first and launched in the
// background; the page follows its state. A run that can't start yet (the project's
// limit on running Computers) waits, and the worker launches it when there's room.

import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import { APPROVAL_MARK, APPROVE, DECLINE, host, open, question, type Moment } from "@/shared/api";
import { follow } from "./follow";
import { explain, HttpError } from "./http";
import { closeSession, ensureComputer, openSession, requireSession, Waiting } from "./pine";
import { read, storedScreen, update, type RunRecord, type StoreData } from "./store";

const KEY = /^r-[a-z0-9]{8,32}$/;

/**
 * What every run carries besides its goal: how to test, how to record each check so
 * this app can read it, and when to stop and ask. The agent writes one small JSON file
 * per check; the file's step in its activity tells this app the moment it was recorded,
 * and the screens saved up to that moment are the evidence (src/server/follow.ts).
 */
export const CONTEXT = [
  "You are testing a web app the way a careful QA engineer would: in the browser, as a user.",
  "",
  "Each thing the person asked you to check is one check. Keep their order and don't split one into several: when a check covers several items, name the ones that differ in what you observed. For each check:",
  "",
  "1. Do what a user would do.",
  "2. Before you record it, put what you observed in view: scroll the page to it, also when you think it is already visible, or go back to it if you have moved on. A picture of the screen is taken after each thing you do in the browser, and the last one before you record the check is kept as its evidence, so it must show what you report.",
  "3. Record it straight away, before you start the next check: write the file checks/NN.json in the work directory (checks/01.json, checks/02.json, and so on), holding one JSON object with exactly these fields:",
  '   {"n": 1, "title": "a short plain name for the check", "status": "passed" or "failed", "expected": "what should happen", "observed": "what you actually saw", "url": "the address of the page where you saw it", "where": "where on that page to look", "steps": ["Open the login page", "Sign in as ...", "..."]}',
  "",
  "Rules:",
  '- A check fails when what you observed differs from what was expected. Report what you saw, never what you assume. If you can\'t carry a check out, record it as failed and say why in "observed".',
  "- Don't work around a defect and don't retry until it passes: a defect is the finding. Record it and move on to the next check.",
  "- Write for a developer who reads the report without having watched: plain words, no selectors, no tool names. Keep \"expected\" and \"observed\" under thirty words each, and say only what the screen shows.",
  `- Before any step that submits a payment, places an order or sends something real, stop and ask. Begin that question with the line "${APPROVAL_MARK}" and say exactly what you are about to do. Entering details on the way there needs no approval.`,
  "- When every check is recorded, answer in one sentence. Don't repeat the checks.",
].join("\n");

const goal = (run: Pick<RunRecord, "target" | "checks">) => `Test ${run.target}\n\nWhat to check:\n${run.checks}`;

/** A target as an address: https unless it says otherwise. */
export function address(target: string): string {
  const text = target.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new HttpError(400, "Give the address of the app to test.");
  }
  if (!url.hostname.includes(".")) throw new HttpError(400, "Give the address of the app to test.");
  return url.toString().replace(/\/$/, "");
}

/** Records a run and launches it. The same key again changes nothing. */
export async function submit(key: string, target: string, checks: string): Promise<void> {
  if (!KEY.test(key)) throw new HttpError(400, "Send the run's key.");
  const url = address(target);
  const fresh = await update((data) => {
    if (data.runs.some((r) => r.id === key)) return false;
    // One run at a time: they share the Computer's one screen.
    if (data.runs.some(open)) throw new HttpError(409, "A run is going. Wait for it, or stop it.");
    data.runs.push({ id: key, target: url, checks, askedAt: new Date().toISOString(), state: "starting", cursor: 0, findings: [], screens: [], moments: [] });
    return true;
  });
  if (fresh) launch(key);
}

// One launch per run at a time, whether a route or the worker asks.
const shared = globalThis as typeof globalThis & { __launching?: Set<string> };
const launching = (shared.__launching ??= new Set());

/** Starts a recorded run on the Computer, in the background. */
export function launch(run: string): void {
  if (launching.has(run)) return;
  launching.add(run);
  void start(run)
    .catch((error) => console.error("launch:", error))
    .finally(() => launching.delete(run));
}

const waitingToStart = (data: StoreData, id: string) => data.runs.find((r) => r.id === id && (r.state === "starting" || r.state === "queued"));

async function start(id: string): Promise<void> {
  const run = waitingToStart(await read(), id);
  if (!run) return;
  try {
    const found = await ensureComputer();
    const session = await openSession(found, id, host(run.target));
    if (!waitingToStart(await read(), id)) return; // stopped while the Computer started
    // The run's key names the submission: sent again (after a lost response, or by the
    // worker after a restart) it returns the turn it started instead of starting another.
    const turn = await session.agent.run(goal(run), { idempotencyKey: id, context: CONTEXT });
    await update((next) => {
      const record = next.runs.find((r) => r.id === id);
      if (record) Object.assign(record, { turnId: turn.turnId, state: turn.state, waiting: undefined });
    });
    follow(id);
  } catch (error) {
    const waiting = error instanceof Waiting ? error.message : null;
    const said = waiting ?? explain(error).error;
    await update((next) => {
      const record = waitingToStart(next, id);
      if (!record) return;
      if (waiting) Object.assign(record, { state: "queued", waiting });
      else Object.assign(record, { state: "failed", summary: said, endedAt: new Date().toISOString() });
    });
  }
}

export async function runOf(id: string): Promise<RunRecord> {
  const run = (await read()).runs.find((r) => r.id === id);
  if (!run) throw new HttpError(404, "That run isn't kept here.");
  return run;
}

export const note = (id: string, moment: Omit<Moment, "at">, change?: (run: RunRecord) => void) =>
  update((data) => {
    const record = data.runs.find((r) => r.id === id);
    if (!record) return;
    record.moments.push({ at: new Date().toISOString(), ...moment });
    change?.(record);
  });

/**
 * Answers the question a run stopped on: Approve, Decline, or a reply in words. The
 * answer opens the Computer's next turn, which carries the same run on.
 */
export async function answer(id: string, reply: "approve" | "decline" | string): Promise<void> {
  const run = await runOf(id);
  if (!run.turnId || run.state !== "needs_input") throw new HttpError(409, "That question has moved on.");
  const approval = question(run.question ?? "").approval;
  if ((reply === "approve" || reply === "decline") && !approval) throw new HttpError(409, "This question needs an answer in words.");
  const text = reply === "approve" ? APPROVE : reply === "decline" ? DECLINE : reply;
  // The same answer again returns the same new turn.
  const opened = await (await requireSession(id)).agent.answer(run.turnId, text);
  await note(id, reply === "approve" ? { kind: "approved" } : reply === "decline" ? { kind: "declined" } : { kind: "answered", text }, (record) => {
    Object.assign(record, { turnId: opened.turnId, state: opened.state, question: undefined });
  });
  follow(id);
}

/** Stops a run: one still waiting is dropped, one running is canceled, a question is closed. */
export async function cancel(id: string): Promise<void> {
  const run = await runOf(id);
  if (!run.turnId) {
    await update((data) => {
      const record = waitingToStart(data, id);
      if (record) Object.assign(record, { state: "canceled", waiting: undefined, summary: "Stopped before it started.", endedAt: new Date().toISOString() });
    });
    return;
  }
  if (!open(run)) return;
  const turn = await (await requireSession(id)).agent.cancel(run.turnId);
  if (run.state === "needs_input") {
    // A closed question ends the run here: the follower isn't watching it.
    await update((data) => {
      const record = data.runs.find((r) => r.id === id);
      if (record) Object.assign(record, { state: "canceled", question: undefined, summary: "Stopped at its question.", endedAt: new Date().toISOString() });
    });
    await closeSession(id);
    return;
  }
  await update((data) => {
    const record = data.runs.find((r) => r.id === id);
    if (record && open(record)) record.state = turn.state === "running" ? "canceling" : turn.state;
  });
  follow(id);
}

/** Forgets a finished run, with its screens. */
export async function remove(id: string): Promise<void> {
  const run = await runOf(id);
  if (open(run)) throw new HttpError(409, "Stop the run first.");
  await update((data) => {
    data.runs = data.runs.filter((r) => r.id !== id);
  });
  await rm(path.dirname(storedScreen(id, "0.webp")), { recursive: true, force: true });
}
