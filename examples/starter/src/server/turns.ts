// The agent's turns, as this app keeps them. Pine retains a session's turns and events
// while its sandbox lives; the answer and files a person came for belong in your
// product, so each finished turn is recorded here and its files copied in. The worker
// (src/server/worker.ts) does it whether or not a page is open.

import "server-only";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTurn, Session } from "@pinesandbox/computer";
import { DATA_DIR, readUser, updateUser, type TurnFile, type TurnRecord } from "./store";

const FILES_DIR = path.join(DATA_DIR, "files");

/** Where a returned file is kept, refusing any path that would leave the turn's folder. */
export function storedFile(user: string, turnId: string, relativePath: string): string {
  const folder = path.join(FILES_DIR, path.basename(user), path.basename(turnId));
  const file = path.resolve(folder, relativePath);
  if (!file.startsWith(folder + path.sep)) throw new Error("That file isn't in the turn's folder.");
  return file;
}

export async function forgetFiles(user: string, turnIds: string[]): Promise<void> {
  await Promise.all(turnIds.map((id) => rm(path.join(FILES_DIR, path.basename(user), path.basename(id)), { recursive: true, force: true })));
}

/** Records a turn the moment it is admitted. */
export async function recordStarted(
  user: string,
  session: string,
  turn: AgentTurn,
  record: Pick<TurnRecord, "kind" | "ask"> & Partial<Pick<TurnRecord, "runKey" | "scheduleId" | "attachments">>,
): Promise<void> {
  await updateUser(user, (data) => {
    if (data.turns.some((t) => t.turnId === turn.turnId)) return;
    data.turns.push({ turnId: turn.turnId, session, runKey: "", askedAt: new Date().toISOString(), state: turn.state, ...record });
  });
}

/** A question, once answered, is history: the answer's turn carries on. */
export async function recordAnswered(user: string, turnId: string): Promise<void> {
  await updateUser(user, (data) => {
    const asked = data.turns.find((t) => t.turnId === turnId);
    if (asked) asked.state = "answered";
  });
}

const ENDED = new Set(["needs_input", "answered", "completed", "failed", "canceled"]);

// One sync per turn at a time, shared by the worker and any page that asks.
const shared = globalThis as typeof globalThis & { __syncing?: Map<string, Promise<TurnRecord | undefined>> };
const syncing = (shared.__syncing ??= new Map());

/**
 * Brings a turn's record up to date: once it has ended, its outcome and a copy of the
 * files it returned. Waits up to `waitMs` for it to end. Safe to call any number of times.
 */
export function sync(user: string, session: Session, turnId: string, waitMs = 10_000): Promise<TurnRecord | undefined> {
  const running = syncing.get(turnId);
  if (running) return running;
  const next = syncOnce(user, session, turnId, waitMs).finally(() => syncing.delete(turnId));
  syncing.set(turnId, next);
  return next;
}

async function syncOnce(user: string, session: Session, turnId: string, waitMs: number): Promise<TurnRecord | undefined> {
  const recorded = (await readUser(user)).turns.find((t) => t.turnId === turnId);
  if (recorded?.files) return recorded; // already complete
  // wait() returns as soon as the turn ends (at once if it has), and never cancels it.
  const turn = await session.agent.wait(turnId, { timeoutMs: waitMs });
  if (!ENDED.has(turn.state) || !turn.result) {
    if (recorded && recorded.state !== turn.state) {
      await updateUser(user, (data) => {
        const record = data.turns.find((t) => t.turnId === turnId);
        if (record && record.state !== "answered") record.state = turn.state;
      });
    }
    return recorded;
  }

  // The result names each file by its path in the working directory, which is how the
  // answer links it. Copy each one in as the turn left it, streamed straight to disk.
  const result = turn.result;
  const files: TurnFile[] = [];
  for (const ref of result.artifacts) {
    const target = storedFile(user, turnId, ref.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await session.openFile(ref.relativePath));
    files.push({ path: ref.relativePath, size: (await stat(target)).size, contentType: ref.contentType });
  }

  return updateUser(user, (data) => {
    let record = data.turns.find((t) => t.turnId === turnId);
    if (!record) {
      // A turn this app didn't start (another backend, say): keep it too.
      record = { turnId, session: session.name, kind: "run", runKey: "", ask: "", askedAt: (turn.startedAt ?? new Date()).toISOString(), state: turn.state };
      data.turns.push(record);
    }
    Object.assign(record, {
      // An answer recorded meanwhile stays: the turn reads needs_input until then.
      state: record.state === "answered" ? "answered" : turn.state,
      summary: result.summary,
      endedAt: (turn.endedAt ?? new Date()).toISOString(),
      durationMs: result.usage.duration.totalMs,
      cost: result.usage.cost.total,
      files,
    });
    return record;
  });
}
