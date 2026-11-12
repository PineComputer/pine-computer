// Episodes: a resident's waking (scheduled, for natives and second brains) or a job
// (asked for through the resident API, for visitor minds). Each is admitted against
// the budget first, runs on the resident's own computer, and is settled at what it
// actually cost.

import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentTurn, Session } from "@pinesandbox/computer";
import { all, get, now, run, DATA_DIR } from "./db";
import { config } from "./config";
import { reserve, settle } from "./ledger";
import { record } from "./record";
import * as homes from "./homes";
import { digest, inboxMarkdown } from "./inbox";
import { wakingPrompt } from "./orientation";
import { apply, parseActions, type Result } from "./actions";
import { requireResident, type Resident } from "./residents";
import { id, money, words } from "./util";

/** The habitat's only answer when Pine's agent stops to ask what to do. */
const NOBODY_ASSIGNS =
  "Nobody here assigns your work or answers questions about what to do. Decide for yourself, write your reasoning in note.md, and carry on. Remember to write your outbox file before you finish.";

const ENDED = new Set(["completed", "failed", "canceled", "needs_input"]);

interface Running {
  residentId: string;
  session?: Session;
  turnId?: string;
}

const shared = globalThis as typeof globalThis & { __running?: Map<string, Running> };
const running = (shared.__running ??= new Map());

export function isRunning(residentId: string): boolean {
  return [...running.values()].some((r) => r.residentId === residentId);
}

export function runningCount(): number {
  return running.size;
}

/** Follows a turn to its end, answering questions the habitat's way, and adds up its cost. */
async function follow(ep: string, session: Session, first: AgentTurn, maxMinutes: number): Promise<{ turn: AgentTurn; cost: number; priced: boolean }> {
  const deadline = Date.now() + (maxMinutes + 2) * 60_000;
  let turn = first;
  let cost = 0;
  let priced = true;
  let answers = 0;
  for (;;) {
    running.get(ep)!.turnId = turn.turnId;
    turn = await session.agent.wait(turn.turnId, { timeoutMs: 30_000 });
    if (!ENDED.has(turn.state)) {
      if (Date.now() > deadline) {
        turn = await session.agent.cancel(turn.turnId);
        turn = await session.agent.wait(turn.turnId, { timeoutMs: 30_000 });
      } else continue;
    }
    const spent = turn.result?.usage.cost.total;
    if (spent === null || spent === undefined) priced = false;
    else cost += spent;
    if (turn.state === "needs_input" && answers < 2 && Date.now() < deadline) {
      answers += 1;
      record(running.get(ep)!.residentId, "asked", `Pine's agent asked: "${turn.question.slice(0, 200)}". The habitat answered that nobody assigns work.`, {
        data: { question: turn.question },
        receipt: { episode: ep, turn: turn.turnId },
      });
      turn = await session.agent.answer(turn.turnId, NOBODY_ASSIGNS);
      continue;
    }
    return { turn, cost, priced };
  }
}

/** The last screen of a turn, kept for the observatory. */
async function saveFrame(session: Session, turn: AgentTurn, ep: string): Promise<string | null> {
  try {
    let after = Math.max(0, turn.firstEventId - 1);
    let last: { data: Uint8Array; mediaType: string } | null = null;
    for (let page = 0; page < 20; page += 1) {
      const got = await session.agent.eventsPage({ after, limit: 200, frames: true });
      for (const event of got.events) {
        const frame = event.frame();
        // Only the browser's screen: after a shell or file step it shows whatever page was left open.
        if (frame && frame.activity?.kind === "browser" && event.eventId <= turn.lastEventId) last = { data: frame.data, mediaType: frame.mediaType };
      }
      if (got.nextAfter >= Math.min(turn.lastEventId, got.latestEventId) || got.nextAfter === after) break;
      after = got.nextAfter;
    }
    if (!last) return null;
    const relative = path.join("frames", `${ep}.${last.mediaType.split("/")[1] ?? "webp"}`);
    mkdirSync(path.join(DATA_DIR, "frames"), { recursive: true });
    writeFileSync(path.join(DATA_DIR, relative), last.data);
    return relative;
  } catch {
    return null;
  }
}

async function latestJournal(session: Session): Promise<string> {
  try {
    const entries = (await session.listFiles({ path: "journal" })).filter((e) => !e.isDir);
    entries.sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
    return entries[0] ? (await homes.readText(session, entries[0].relativePath)).slice(0, 6000) : "";
  } catch {
    return "";
  }
}

function loopNotices(resident: Resident): string[] {
  if (resident.quiet_streak < 2) return [];
  return [
    `Your last ${resident.quiet_streak} wakings changed nothing in the habitat and left your note as it was. That is allowed. If it isn't what you meant, try a different approach.`,
  ];
}

/** One waking of a native or second-brain resident. */
export async function waking(residentId: string): Promise<void> {
  const resident = requireResident(residentId);
  const cfg = config();
  const ep = id("ep");
  const hold = reserve(resident.id, cfg.episodeReserve, ep);
  if ("refused" in hold) {
    run("update residents set next_wake_at = ? where id = ?", new Date(Date.now() + resident.rhythm_minutes * 60_000).toISOString(), resident.id);
    record(resident.id, "slept-through", `${resident.name} slept through a waking: ${hold.refused}.`, { subject: resident.id });
    return;
  }
  running.set(ep, { residentId: resident.id });
  const startedAt = now();
  run("insert into episodes (id, resident_id, kind, started_at, state, reserved) values (?, ?, 'waking', ?, 'running', ?)", ep, resident.id, startedAt, cfg.episodeReserve);
  record(resident.id, "woke", `${resident.name} woke up.`, { subject: ep });
  let cost = 0;
  try {
    const home = await homes.wake(resident);
    running.get(ep)!.session = home.session;
    const owed = [...home.notes, ...(await homes.handOver(resident, home.computer, home.session))];
    await home.session.writeFile(`inbox-${ep}.md`, inboxMarkdown(digest(resident, [...owed, ...loopNotices(resident)])));
    const first = await home.session.agent.run(wakingPrompt(ep), { idempotencyKey: ep, constraints: { maxWallMs: cfg.episodeMaxMinutes * 60_000 } });
    run("update episodes set turn_id = ? where id = ?", first.turnId, ep);
    const ended = await follow(ep, home.session, first, cfg.episodeMaxMinutes);
    cost = ended.cost;

    const receipt = { episode: ep, turn: ended.turn.turnId, via: "home" as const };
    const { actions, problem } = parseActions(await homes.readText(home.session, `outbox/${ep}.json`));
    const results: Result[] = await apply(resident, actions, receipt, home);
    if (problem) results.unshift({ action: "outbox", ok: false, detail: problem });
    const note = (await homes.readText(home.session, "note.md")).slice(0, 12_000);
    const journal = await latestJournal(home.session);
    const frame = await saveFrame(home.session, ended.turn, ep);
    const changed = results.some((r) => r.ok) || note !== resident.note;
    const intention = actions.intention?.trim() || resident.intention;
    const next = new Date(Date.now() + (actions.wakeAfterMinutes ?? resident.rhythm_minutes) * 60_000).toISOString();
    run(
      "update residents set note = ?, intention = ?, last_wake_at = ?, next_wake_at = ?, quiet_streak = ? where id = ?",
      note,
      intention,
      startedAt,
      next,
      changed ? 0 : resident.quiet_streak + 1,
      resident.id,
    );
    run(
      "update episodes set state = 'done', ended_at = ?, cost = ?, intention = ?, summary = ?, journal = ?, frame = ?, applied = ?, results = ? where id = ?",
      now(),
      cost,
      actions.intention ?? "",
      (ended.turn.result?.summary ?? "").slice(0, 4000),
      journal,
      frame,
      results.filter((r) => r.ok).length,
      JSON.stringify(results),
      ep,
    );
    record(resident.id, "slept", `${resident.name} went back to sleep${actions.intention ? `: ${actions.intention}` : "."}`, {
      subject: ep,
      data: { results, ended: ended.turn.state },
      receipt: { episode: ep, turn: ended.turn.turnId, agent: "pine", cost, priced: ended.priced },
    });
  } catch (error) {
    run("update episodes set state = 'failed', ended_at = ?, cost = ?, error = ? where id = ?", now(), cost, words(error), ep);
    run("update residents set next_wake_at = ? where id = ?", new Date(Date.now() + 30 * 60_000).toISOString(), resident.id);
    record(resident.id, "waking-failed", `${resident.name}'s waking failed: ${words(error)}`, { subject: ep, data: { error: words(error) } });
  } finally {
    settle(hold.id, cost, `waking ${ep}`);
    running.delete(ep);
    await homes.sleep(resident).catch((error) => record(resident.id, "sleep-failed", `${resident.name}'s home didn't go to sleep: ${words(error)}`));
  }
}

/** A job a visitor mind asked its home to do, through the resident API. Its home stays awake briefly after. */
export async function job(residentId: string, goal: string): Promise<string> {
  const resident = requireResident(residentId);
  const cfg = config();
  const ep = id("job");
  const hold = reserve(resident.id, cfg.episodeReserve, ep);
  if ("refused" in hold) throw new Error(`Not enough energy: ${hold.refused}.`);
  running.set(ep, { residentId: resident.id });
  run("insert into episodes (id, resident_id, kind, goal, started_at, state, reserved) values (?, ?, 'job', ?, ?, 'running', ?)", ep, resident.id, goal, now(), cfg.episodeReserve);
  record(resident.id, "job", `${resident.name} set its home a job.`, { subject: ep, data: { goal } });
  void (async () => {
    let cost = 0;
    try {
      const home = await homes.wake(resident);
      running.get(ep)!.session = home.session;
      await homes.handOver(resident, home.computer, home.session);
      const first = await home.session.agent.run(goal, { idempotencyKey: ep, constraints: { maxWallMs: cfg.episodeMaxMinutes * 60_000 } });
      run("update episodes set turn_id = ? where id = ?", first.turnId, ep);
      const ended = await follow(ep, home.session, first, cfg.episodeMaxMinutes);
      cost = ended.cost;
      const frame = await saveFrame(home.session, ended.turn, ep);
      const files = ended.turn.result?.artifacts.map((a) => a.relativePath) ?? [];
      run(
        "update episodes set state = 'done', ended_at = ?, cost = ?, summary = ?, frame = ?, results = ? where id = ?",
        now(),
        cost,
        (ended.turn.result?.summary ?? "").slice(0, 4000),
        frame,
        JSON.stringify(files.map((f) => ({ action: "file", ok: true, detail: f }))),
        ep,
      );
      record(resident.id, "job-done", `${resident.name}'s home finished a job (${money(cost)}).`, { subject: ep, receipt: { episode: ep, turn: ended.turn.turnId, cost } });
    } catch (error) {
      run("update episodes set state = 'failed', ended_at = ?, cost = ?, error = ? where id = ?", now(), cost, words(error), ep);
      record(resident.id, "job-failed", `${resident.name}'s job failed: ${words(error)}`, { subject: ep });
    } finally {
      settle(hold.id, cost, `job ${ep}`);
      running.delete(ep);
    }
  })();
  return ep;
}

/** Stops the world now: in-flight turns cancelled, every home put to sleep. */
export async function halt(): Promise<void> {
  await Promise.allSettled(
    [...running.values()].map(async (r) => {
      if (r.session && r.turnId) await r.session.agent.cancel(r.turnId);
    }),
  );
  const awake = all<{ resident_id: string }>("select resident_id from homes where state in ('running', 'starting')");
  await Promise.allSettled(awake.map((h) => homes.sleep(requireResident(h.resident_id))));
}

export interface EpisodeRow {
  id: string;
  resident_id: string;
  kind: string;
  goal: string;
  started_at: string;
  ended_at: string | null;
  state: string;
  turn_id: string | null;
  intention: string;
  cost: number | null;
  summary: string;
  journal: string;
  frame: string | null;
  applied: number;
  results: string;
  error: string | null;
}

export function episodesOf(residentId: string, limit = 30): EpisodeRow[] {
  return all<EpisodeRow>("select * from episodes where resident_id = ? order by started_at desc limit ?", residentId, limit);
}

export function episode(epId: string): EpisodeRow | undefined {
  return get<EpisodeRow>("select * from episodes where id = ?", epId);
}
