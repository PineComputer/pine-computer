// The work that happens with no page open, in the server process (started from
// src/instrumentation.ts). Every few seconds:
//
// - each running run is followed until it ends, then recorded and its brief moved on;
// - a run waiting in the queue (or left starting by a restart) is launched again;
// - each running Computer is looked at, so one that idled out reads as stopped.
//
// One process runs it. Several processes would need a lock, or a job queue, around it.

import "server-only";
import { advance, follow, launch } from "./desk";
import { check } from "./pine";
import { read } from "./store";

const TICK_MS = 3_000;
/** Queued runs, briefs and Computers are looked at every fifth tick. */
const SLOW = 5;
const LIVE = new Set(["running", "canceling"]);

interface WorkerState {
  following: Set<string>;
  ticks: number;
}

const shared = globalThis as typeof globalThis & { __worker?: WorkerState };

export function startWorker(): void {
  if (shared.__worker) return;
  const state: WorkerState = (shared.__worker = { following: new Set(), ticks: 0 });
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick(state)
      .catch((error) => console.error("worker:", error))
      .finally(() => (ticking = false));
  }, TICK_MS).unref();
}

async function tick(state: WorkerState): Promise<void> {
  const data = await read();
  const slow = state.ticks++ % SLOW === 0;

  for (const run of data.runs) {
    if (run.state === "starting" || (run.state === "queued" && slow)) launch(run.id);
    if (!LIVE.has(run.state) || !run.turnId || state.following.has(run.id)) continue;
    state.following.add(run.id);
    void follow(run)
      .catch((error) => console.error("worker: following a run:", error))
      .finally(() => state.following.delete(run.id));
  }

  if (slow) {
    await Promise.allSettled(data.readers.filter((r) => r.computer?.binding).map((r) => check(r.id)));
    // A brief whose run ended while the server was down still moves on.
    await Promise.allSettled(data.briefs.filter((b) => b.state !== "done" && b.state !== "failed" && b.state !== "draft").map((b) => advance(b.id)));
  }
}
