// A job's outcome, as this app keeps it. Pine retains a session's turns and events
// while its sandbox lives; the answer, the steps and the files a person came for belong
// in your product, so each ended turn is recorded here, its files copied in and the
// pictures of the screen its steps left saved beside them. The worker
// (src/server/worker.ts) does it whether or not a page is open.

import "server-only";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTurn, Session } from "@pinesandbox/computer";
import type { WireEvent } from "@/shared/events";
import { fold, type Item } from "@/shared/fold";
import { DATA_DIR, read, update, type JobRecord, type TurnFile } from "./store";
import { toWire } from "./wire";

const FILES_DIR = path.join(DATA_DIR, "files");
const SHOTS_DIR = path.join(DATA_DIR, "shots");

/** Where a returned file is kept, refusing any path that would leave the job's folder. */
export function storedFile(job: string, relativePath: string): string {
  const folder = path.join(FILES_DIR, path.basename(job));
  const file = path.resolve(folder, relativePath);
  if (!file.startsWith(folder + path.sep)) throw new Error("That file isn't in the job's folder.");
  return file;
}

/** Where a picture of the screen from a job's trail is kept; `name` is its event's id and its type. */
export function storedShot(job: string, name: string): string {
  if (!/^\d+\.(webp|png|jpeg)$/.test(name)) throw new Error("That isn't a picture from the job's trail.");
  return path.join(SHOTS_DIR, path.basename(job), name);
}

export async function forgetFiles(jobs: string[]): Promise<void> {
  await Promise.all(jobs.flatMap((id) => [FILES_DIR, SHOTS_DIR].map((dir) => rm(path.join(dir, path.basename(id)), { recursive: true, force: true }))));
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
  const items = await steps(session, turn, job).catch((error) => {
    console.error("turns: reading a job's steps:", error);
    return [] as Item[];
  });

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

/**
 * The turn's steps and notes, read back from the session's retained events. Each
 * picture of the screen is saved under the job, and its step keeps the picture's name.
 */
async function steps(session: Session, turn: AgentTurn, job: string): Promise<Item[]> {
  const events: WireEvent[] = [];
  const pictures: Promise<void>[] = [];
  await mkdir(path.dirname(storedShot(job, "0.webp")), { recursive: true });
  let after = Math.max(0, turn.firstEventId - 1);
  while (after < turn.lastEventId) {
    // Pictures make a page heavy: read a few events at a time.
    const page = await session.agent.eventsPage({ after, limit: 40 });
    for (const event of page.events) {
      if (event.eventId > turn.lastEventId) continue;
      const wire = toWire(event, (data, mediaType) => {
        const name = `${event.eventId}.${mediaType.split("/")[1] ?? "webp"}`;
        pictures.push(writeFile(storedShot(job, name), data));
        return name;
      });
      if (wire) events.push(wire);
    }
    if (page.nextAfter <= after) break;
    after = page.nextAfter;
  }
  await Promise.all(pictures);
  return fold(events).get(turn.turnId)?.items ?? [];
}
