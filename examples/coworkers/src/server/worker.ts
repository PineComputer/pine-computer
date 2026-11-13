// The work that happens with no page open, in the server process (started from
// src/instrumentation.ts). Every few seconds:
//
// - each running job is followed until it ends, then recorded with its steps and files;
// - a job waiting in the queue (or left starting by a restart) is launched again;
// - each running Computer is looked at, so one that idled out reads as stopped.
//
// One process runs it. Several processes would need a lock, or a job queue, around it.

import "server-only";
import { launch } from "./jobs";
import { publish } from "./live";
import { check, session } from "./pine";
import { read, type JobRecord } from "./store";
import { sync } from "./turns";

const TICK_MS = 4_000;
/** Queued jobs and Computers are looked at every fifth tick. */
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

  for (const job of data.jobs) {
    if (job.state === "starting" || (job.state === "queued" && slow)) launch(job.id);
    if (!LIVE.has(job.state) || !job.turnId || state.following.has(job.id)) continue;
    state.following.add(job.id);
    void follow(job).finally(() => state.following.delete(job.id));
  }

  if (slow) {
    await Promise.allSettled(data.coworkers.filter((c) => c.computer?.binding).map((c) => check(c.id)));
  }
}

/** Waits a while for the job's turn to end and records it; the next tick carries on if it hasn't. */
async function follow(job: JobRecord): Promise<void> {
  try {
    const target = await session(job.thread);
    if (!target) return void (await check(job.coworker));
    const record = await sync(target, job.id, 25_000);
    if (!record?.files) return;
    const { coworkers } = await read();
    const name = coworkers.find((c) => c.id === job.coworker)?.name ?? "A coworker";
    const href = `/t/${job.thread}`;
    if (record.state === "completed") publish({ type: "notice", tone: "done", text: `${name} finished a job`, href });
    else if (record.state === "needs_input") publish({ type: "notice", tone: "info", text: `${name} has a question for you`, href });
    else if (record.state === "failed") publish({ type: "notice", tone: "failed", text: `${name} couldn't finish a job`, href });
  } catch (error) {
    // The sandbox went away (it idled out, or stopped elsewhere): its jobs end with it.
    if ((await check(job.coworker).catch(() => "running")) === "running") console.error("worker: following a job:", error);
  }
}
