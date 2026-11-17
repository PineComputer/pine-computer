// One check, from start to end: start the Computer, hand Pine's agent the job, keep the
// step it is on and the last picture of the screen, then store the reading and compare
// it with the reading stored before it. The worker (src/server/worker.ts) drives every
// check, so one runs whether or not a page is open, and carries on after a restart.

import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentFrame, AgentTurn, Session } from "@pinesandbox/computer";
import { after } from "@/shared/cadence";
import { HttpError, words } from "./http";
import { alive, control, ensureRunning, released, session } from "./pine";
import { compare, goalFor, parseReading, sentence } from "./reading";
import { DATA_DIR, readUser, updateUser, type CheckRecord, type UserData } from "./store";

const SCREENS_DIR = path.join(DATA_DIR, "screens");
const LIVE = new Set(["starting", "running", "asking"]);

/** How long a scheduled slot keeps trying for a Computer before it is skipped. */
const RETRY_MS = 2 * 60_000;
const GIVE_UP_MS = 30 * 60_000;

export const liveCheck = (data: UserData) => data.checks.find((c) => LIVE.has(c.state));

/** Where a check's picture is kept. */
export function screenFile(user: string, checkId: string): string {
  return path.join(SCREENS_DIR, path.basename(user), `${path.basename(checkId)}.webp`);
}

export async function forgetScreens(user: string, checkIds: string[]): Promise<void> {
  await Promise.all(checkIds.map((id) => rm(screenFile(user, id), { force: true })));
}

/**
 * Opens a check on a watch. `slot` is a scheduled check's due time; without it the check
 * was asked for by hand (or is the watch's first). One check has the Computer at a time.
 */
export async function begin(user: string, watchId: string, trigger: CheckRecord["trigger"], slot?: string): Promise<string> {
  return updateUser(user, (data) => {
    const watch = data.watches.find((w) => w.id === watchId);
    if (!watch) throw new HttpError(404, "There's no such watch.");
    if (liveCheck(data)) throw new HttpError(409, "The Computer is busy with another check. Try again when it ends.");
    const id = `chk_${randomBytes(5).toString("hex")}`;
    data.checks.push({
      id,
      watchId,
      trigger,
      ...(slot ? { dueAt: slot } : {}),
      // A slot's key is its due time, so a slot is never checked twice.
      runKey: `${watchId}@${slot ?? id}`,
      startedAt: new Date().toISOString(),
      state: "starting",
      step: "Starting the Computer",
    });
    return id;
  });
}

async function patch(user: string, checkId: string, change: Partial<CheckRecord>): Promise<void> {
  await updateUser(user, (data) => {
    const check = data.checks.find((c) => c.id === checkId);
    if (check) Object.assign(check, change);
  });
}

async function fail(user: string, checkId: string, problem: string): Promise<void> {
  await patch(user, checkId, { state: "failed", problem, endedAt: new Date().toISOString(), step: undefined, question: undefined });
}

/** Takes a live check as far as it goes now: to its end, or to a question for the person. */
export async function drive(user: string, checkId: string): Promise<void> {
  const data = await readUser(user);
  const check = data.checks.find((c) => c.id === checkId);
  const watch = data.watches.find((w) => w.id === check?.watchId);
  if (!check || !watch) return;

  let target: Session | null;
  let turnId = check.turnId;
  try {
    if (check.state === "starting") {
      target = await ensureRunning(user);
      await patch(user, checkId, { step: "Opening the page" });
      const last = data.checks.findLast((c) => c.watchId === watch.id && c.state === "done");
      const turn = await target.agent.run(goalFor(watch, last?.fields?.map((f) => f.label)), { idempotencyKey: check.runKey });
      turnId = turn.turnId;
      await updateUser(user, (next) => {
        const c = next.checks.find((x) => x.id === checkId);
        if (c) Object.assign(c, { state: "running", turnId });
        // The slot is taken: the watch moves on to its next time.
        const w = next.watches.find((x) => x.id === watch.id);
        if (w && check.dueAt === w.nextAt) Object.assign(w, { nextAt: after(w.cadence, new Date(w.nextAt), new Date()).toISOString(), retryAt: undefined, waiting: undefined });
      });
    } else {
      target = await session(user);
      if (!target || !turnId) return lost(user, checkId);
    }
  } catch (error) {
    await notStarted(user, check, error);
    return;
  }

  try {
    const turn = await follow(user, target, checkId, turnId!);
      // The question, without the empty reading the agent may append to it.
    if (turn.state === "needs_input") {
      await patch(user, checkId, { state: "asking", question: turn.question.replace(/```[\s\S]*?```/g, "").trim() || "The page needs you.", step: undefined });
    } else if (turn.state === "completed" && turn.result) {
      await finish(user, checkId, turn.result.summary);
    } else {
      await fail(user, checkId, turn.state === "canceled" ? "Canceled." : words(turn.result?.summary || "The check didn't finish."));
    }
  } catch (error) {
    // The sandbox went away (it idled out, or stopped elsewhere): the check ends with it.
    if (!(await alive(user).catch(() => true))) {
      await lost(user, checkId);
    } else {
      console.error("check:", error);
      await fail(user, checkId, error instanceof Error ? words(error.message) : "The check didn't finish.");
    }
  } finally {
    frames.delete(checkId);
  }
}

/** The Computer went away under a live check (it idled out while it waited, say): the check ends with it. */
export async function lost(user: string, checkId: string): Promise<void> {
  await released(user);
  await fail(user, checkId, "The Computer stopped before the check ended.");
}

/** A check whose Computer wouldn't start: a scheduled slot tries again, a check by hand says why. */
async function notStarted(user: string, check: CheckRecord, error: unknown): Promise<void> {
  const reason = error instanceof Error ? words(error.message) : "The Computer didn't start.";
  console.error("check: not started:", reason);
  const late = check.dueAt ? Date.now() - Date.parse(check.dueAt) > GIVE_UP_MS : true;
  if (late) {
    await fail(user, check.id, `It didn't start: ${reason}`);
    // A slot that never got a Computer is skipped: the watch moves on to its next time.
    return updateUser(user, (data) => {
      const watch = data.watches.find((w) => w.id === check.watchId);
      if (watch && check.dueAt === watch.nextAt) Object.assign(watch, { nextAt: after(watch.cadence, new Date(watch.nextAt), new Date()).toISOString(), retryAt: undefined, waiting: undefined });
    });
  }
  await updateUser(user, (data) => {
    data.checks = data.checks.filter((c) => c.id !== check.id);
    const watch = data.watches.find((w) => w.id === check.watchId);
    if (watch) Object.assign(watch, { waiting: reason, retryAt: new Date(Date.now() + RETRY_MS).toISOString() });
  });
}

// The last picture of the screen each live check has seen, until it is kept on disk.
const shared = globalThis as typeof globalThis & { __frames?: Map<string, AgentFrame> };
const frames = (shared.__frames ??= new Map());

/**
 * Follows a turn to its end. The agent's activity is for showing (the step, the screen);
 * the outcome comes from wait(), which returns as soon as the turn ends.
 */
async function follow(user: string, target: Session, checkId: string, turnId: string): Promise<AgentTurn> {
  const done = new AbortController();
  const watching = (async () => {
    const { taskId } = await target.agent.status();
    for await (const event of target.agent.events({ expectedTaskId: taskId, signal: done.signal })) {
      if (event.turnId && event.turnId !== turnId) continue; // an earlier turn of this check, replayed
      // Only what happens in the browser is shown: a step there is plain words ("Open a
      // page"), and from the first one on the Computer's screen has something to see.
      const step = event.activity();
      if (step?.kind === "browser") await patch(user, checkId, { step: step.facts?.page?.title ? `${step.title} · ${step.facts.page.title}` : step.title, onScreen: true });
      const frame = event.frame();
      if (frame) frames.set(checkId, frame);
      if (event.type === "result") break;
    }
  })().catch(() => undefined);

  let turn = await target.agent.wait(turnId, { timeoutMs: 25_000 });
  while (turn.state === "running" || turn.state === "canceling") turn = await target.agent.wait(turnId, { timeoutMs: 25_000 });
  // The last frames trail the result by a moment.
  await Promise.race([watching, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  done.abort();
  return turn;
}

/** Stores what the check read and its picture, and compares it with the reading before it. */
async function finish(user: string, checkId: string, answer: string): Promise<void> {
  const reading = parseReading(answer);
  if (!reading) return fail(user, checkId, words(answer.slice(0, 240)) || "It came back without a reading.");
  const frame = frames.get(checkId);
  if (frame) {
    const file = screenFile(user, checkId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, frame.data);
  }
  await updateUser(user, (data) => {
    const check = data.checks.find((c) => c.id === checkId);
    if (!check) return;
    const previous = data.checks.findLast((c) => c.watchId === check.watchId && c.state === "done");
    const differences = previous?.fields ? compare(previous.fields, reading.fields) : [];
    Object.assign(check, {
      state: "done",
      endedAt: new Date().toISOString(),
      step: undefined,
      question: undefined,
      fields: reading.fields,
      place: reading.place,
      screen: frame ? `${checkId}.webp` : undefined,
      outcome: !previous ? "first" : differences.length ? "changed" : "same",
      comparedWith: previous?.id,
      change: differences.length ? { sentence: sentence(differences), differences } : undefined,
    });
  });
}

/** The person's answer to a check's question: hand back the controls and let the agent carry on. */
export async function answer(user: string, checkId: string, text: string): Promise<void> {
  const data = await readUser(user);
  const check = data.checks.find((c) => c.id === checkId);
  const target = await session(user);
  if (!check?.turnId || check.state !== "asking" || !target) throw new HttpError(409, "This check isn't waiting for you.");
  if (data.computer?.driving) await control(user, "release");
  const turn = await target.agent.answer(check.turnId, text);
  // The answer opened a new turn: the worker follows it from here.
  await patch(user, checkId, { state: "running", turnId: turn.turnId, question: undefined, step: "Carrying on" });
}

/** Ends a live check by hand. */
export async function cancel(user: string, checkId: string): Promise<void> {
  const data = await readUser(user);
  const check = data.checks.find((c) => c.id === checkId);
  if (!check || !LIVE.has(check.state)) return;
  const target = await session(user).catch(() => null);
  if (data.computer?.driving) await control(user, "release").catch(() => undefined);
  if (target && check.turnId) await target.agent.cancel(check.turnId).catch(() => undefined);
  // A running turn ends as canceled and the worker records it; a question has no turn left to end.
  if (check.state !== "running") await fail(user, checkId, "Canceled.");
}
