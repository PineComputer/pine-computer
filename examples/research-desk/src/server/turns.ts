// A run's outcome, as this app keeps it. Pine retains a session's turns and events
// while its sandbox lives; the notes, the steps and above all the screens of the pages
// a reader opened belong in your product, so each ended run is recorded here: the file
// it returned, its steps, and a picture of every page its browser was on. The report's
// sources are built from these records and nothing else.

import "server-only";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTurn, Session } from "@pinesandbox/computer";
import type { WireEvent } from "@/shared/events";
import { fold, type Item } from "@/shared/fold";
import { sameAs, type Page } from "@/shared/notes";
import { stepsIn } from "@/shared/steps";
import { check, session } from "./pine";
import { DATA_DIR, read, update, type RunRecord } from "./store";
import { toWire } from "./wire";

const SHOTS_DIR = path.join(DATA_DIR, "shots");

/** Where a picture of the screen from a run is kept; `name` is its event's id and its type. */
export function storedShot(run: string, name: string): string {
  if (!/^\d+\.(webp|png|jpeg)$/.test(name)) throw new Error("That isn't a picture from the run.");
  return path.join(SHOTS_DIR, path.basename(run), name);
}

export async function forgetShots(runs: string[]): Promise<void> {
  await Promise.all(runs.map((id) => rm(path.join(SHOTS_DIR, path.basename(id)), { recursive: true, force: true })));
}

/** The file each kind of run is asked to return. */
export const RETURNS: Record<RunRecord["kind"], string> = { plan: "angles.json", read: "notes.json", write: "report.json" };

const ENDED = new Set(["completed", "failed", "canceled"]);

// One sync per run at a time, shared by the worker and any route that asks.
const shared = globalThis as typeof globalThis & { __syncing?: Map<string, Promise<void>> };
const syncing = (shared.__syncing ??= new Map());

/**
 * Brings a run's record up to date: once its turn has ended, the outcome, the file it
 * returned, its steps and the pages it opened. Waits up to `waitMs` for it to end. Safe
 * to call any number of times.
 */
export function sync(run: string, waitMs = 10_000): Promise<void> {
  const running = syncing.get(run);
  if (running) return running;
  const next = syncOnce(run, waitMs).finally(() => syncing.delete(run));
  syncing.set(run, next);
  return next;
}

async function syncOnce(id: string, waitMs: number): Promise<void> {
  const recorded = (await read()).runs.find((r) => r.id === id);
  if (!recorded?.turnId || recorded.items) return; // not admitted yet, or already complete
  const target = await session(id);
  // The sandbox went away (it idled out, or stopped elsewhere): its runs end with it.
  if (!target) return void (await check(recorded.reader));

  // wait() returns as soon as the turn ends (at once if it has), and never cancels it.
  const turn = await target.agent.wait(recorded.turnId, { timeoutMs: waitMs });
  if (!ENDED.has(turn.state) || !turn.result) {
    const question = turn.state === "needs_input" ? turn.question : undefined;
    if (recorded.state !== turn.state || recorded.summary !== question) {
      await update((data) => {
        const record = data.runs.find((r) => r.id === id);
        // A reply recorded meanwhile moved the run on to its next turn.
        if (record && record.turnId === turn.turnId) Object.assign(record, { state: turn.state, summary: question });
      });
    }
    return;
  }

  // The result names each file by its path in the work directory.
  const wanted = RETURNS[recorded.kind];
  const file = turn.result.artifacts.find((ref) => path.basename(ref.relativePath) === wanted);
  const returned = file
    ? await target
        .readFile(file.relativePath)
        .then((bytes) => new TextDecoder().decode(bytes))
        .catch(() => undefined)
    : undefined;
  const items = await steps(target, turn, id).catch((error) => {
    console.error("turns: reading a run's steps:", error);
    return [] as Item[];
  });
  const result = turn.result;

  await update((data) => {
    const record = data.runs.find((r) => r.id === id);
    if (!record) return;
    Object.assign(record, { state: turn.state, summary: result.summary, endedAt: (turn.endedAt ?? new Date()).toISOString(), items, pages: pagesIn(items), returned });
  });
}

/**
 * The run's steps and notes, read back from the session's retained events. Each picture
 * of the screen is saved under the run, and its step keeps the picture's name.
 */
async function steps(target: Session, turn: AgentTurn, run: string): Promise<Item[]> {
  const events: WireEvent[] = [];
  const pictures: Promise<void>[] = [];
  await mkdir(path.dirname(storedShot(run, "0.webp")), { recursive: true });
  // The session was opened for this run: its history is the run's, from the first event.
  let after = 0;
  while (after < turn.lastEventId) {
    // Pictures make a page heavy: read a few events at a time.
    const page = await target.agent.eventsPage({ after, limit: 40 });
    for (const event of page.events) {
      if (event.eventId > turn.lastEventId) continue;
      const wire = toWire(run, event, (data, mediaType) => {
        const name = `${event.eventId}.${mediaType.split("/")[1] ?? "webp"}`;
        pictures.push(writeFile(storedShot(run, name), data));
        return name;
      });
      if (wire) events.push(wire);
    }
    if (page.nextAfter <= after) break;
    after = page.nextAfter;
  }
  await Promise.all(pictures);
  return fold(events);
}

/** The pages a run's browser was on, each once, with the first picture of the screen there. */
export function pagesIn(items: readonly Item[]): Page[] {
  const pages: Page[] = [];
  for (const step of stepsIn(items)) {
    if (step.type !== "browser" || !step.shot || !/^https?:\/\//i.test(step.url ?? "")) continue;
    const known = pages.find((p) => sameAs(p.url) === sameAs(step.url!));
    if (!known) pages.push({ url: step.url!, title: step.page ?? "", shot: step.shot });
    else if (!known.title && step.page) known.title = step.page;
  }
  return pages;
}
