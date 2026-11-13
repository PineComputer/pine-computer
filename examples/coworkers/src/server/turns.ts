// A job's outcome, as this app keeps it. Pine retains a session's turns and events
// while its sandbox lives; the answer, the steps and the files a person came for belong
// in your product, so each ended turn is recorded here and its files copied in. The
// worker (src/server/worker.ts) does it whether or not a page is open.

import "server-only";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTurn, Session } from "@pinesandbox/computer";
import type { WireEvent } from "@/shared/events";
import { fold, type Item } from "@/shared/fold";
import { DATA_DIR, read, update, type JobRecord, type TurnFile } from "./store";
import { toWire } from "./wire";

const FILES_DIR = path.join(DATA_DIR, "files");

/** Where a returned file is kept, refusing any path that would leave the job's folder. */
export function storedFile(job: string, relativePath: string): string {
  const folder = path.join(FILES_DIR, path.basename(job));
  const file = path.resolve(folder, relativePath);
  if (!file.startsWith(folder + path.sep)) throw new Error("That file isn't in the job's folder.");
  return file;
}

export async function forgetFiles(jobs: string[]): Promise<void> {
  await Promise.all(jobs.map((id) => rm(path.join(FILES_DIR, path.basename(id)), { recursive: true, force: true })));
}

const ENDED = new Set(["needs_input", "answered", "completed", "failed", "canceled"]);

// One sync per job at a time, shared by the worker and any route that asks.
const shared = globalThis as typeof globalThis & { __syncing?: Map<string, Promise<JobRecord | undefined>> };
const syncing = (shared.__syncing ??= new Map());

/**
 * Brings a job's record up to date: once its turn has ended, the outcome, its steps
 * and a copy of the files it returned. Waits up to `waitMs` for it to end. Safe to call
 * any number of times.
 */
export function sync(session: Session, job: string, waitMs = 10_000): Promise<JobRecord | undefined> {
  const running = syncing.get(job);
  if (running) return running;
  const next = syncOnce(session, job, waitMs).finally(() => syncing.delete(job));
  syncing.set(job, next);
  return next;
}

async function syncOnce(session: Session, job: string, waitMs: number): Promise<JobRecord | undefined> {
  const recorded = (await read()).jobs.find((j) => j.id === job);
  if (!recorded?.turnId || recorded.files) return recorded; // not admitted yet, or already complete
  // wait() returns as soon as the turn ends (at once if it has), and never cancels it.
  const turn = await session.agent.wait(recorded.turnId, { timeoutMs: waitMs });
  if (!ENDED.has(turn.state) || !turn.result) {
    if (recorded.state !== turn.state) {
      await update((data) => {
        const record = data.jobs.find((j) => j.id === job);
        if (record && record.state !== "answered") record.state = turn.state;
      });
    }
    return recorded;
  }

  // The result names each file by its path in the work directory, which is how the
  // answer links it. Copy each one in as the turn left it, streamed straight to disk.
  const result = turn.result;
  const files: TurnFile[] = [];
  for (const ref of result.artifacts) {
    const target = storedFile(job, ref.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await session.openFile(ref.relativePath));
    files.push({ path: ref.relativePath, size: (await stat(target)).size, contentType: ref.contentType });
  }
  const items = await steps(session, turn).catch(() => [] as Item[]);

  return update((data) => {
    const record = data.jobs.find((j) => j.id === job);
    if (!record) return undefined;
    Object.assign(record, {
      // A reply recorded meanwhile stays: the turn reads needs_input until then.
      state: record.state === "answered" ? "answered" : turn.state,
      summary: result.summary,
      endedAt: (turn.endedAt ?? new Date()).toISOString(),
      durationMs: result.usage.duration.totalMs,
      cost: result.usage.cost.total,
      items,
      files,
    });
    return record;
  });
}

/** The turn's steps and notes, read back from the session's retained events, without the pictures. */
async function steps(session: Session, turn: AgentTurn): Promise<Item[]> {
  const events: WireEvent[] = [];
  let after = Math.max(0, turn.firstEventId - 1);
  while (after < turn.lastEventId) {
    const page = await session.agent.eventsPage({ after, limit: 200, frames: false });
    for (const event of page.events) {
      const wire = event.eventId <= turn.lastEventId ? toWire(event) : null;
      if (wire) events.push(wire);
    }
    if (page.nextAfter <= after) break;
    after = page.nextAfter;
  }
  return fold(events).get(turn.turnId)?.items ?? [];
}
