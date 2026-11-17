// The work that happens with no page open, in the server process (started from
// src/instrumentation.ts). Every few seconds:
//
// - a run that is going is followed (src/server/follow.ts), also after a restart;
// - a run waiting to start (or left starting by a restart) is launched again;
// - a run a person is driving is looked at, so controls the Computer took back are noticed;
// - the running Computer is looked at, so one that idled out reads as stopped.
//
// One process runs it. Several processes would need a lock, or a job queue, around it.

import "server-only";
import { watchDriver } from "./control";
import { follow } from "./follow";
import { check } from "./pine";
import { launch } from "./runs";
import { read } from "./store";

const TICK_MS = 3_000;
/** Queued runs and the Computer are looked at every fifth tick. */
const SLOW = 5;
const LIVE = new Set(["running", "canceling"]);

const shared = globalThis as typeof globalThis & { __worker?: { ticks: number } };

export function startWorker(): void {
  if (shared.__worker) return;
  const state = (shared.__worker = { ticks: 0 });
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick(state.ticks++ % SLOW === 0)
      .catch((error) => console.error("worker:", error))
      .finally(() => (ticking = false));
  }, TICK_MS).unref();
}

async function tick(slow: boolean): Promise<void> {
  const data = await read();
  for (const run of data.runs) {
    if (run.state === "starting" || (run.state === "queued" && slow)) launch(run.id);
    if (LIVE.has(run.state) && run.turnId) follow(run.id);
    if (run.driving) void watchDriver(run.id).catch((error) => console.error("worker: the controls:", error));
  }
  if (slow && data.computer?.binding) await check();
}
