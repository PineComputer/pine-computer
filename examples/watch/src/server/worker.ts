// The work that happens with no page open, in the server process (started from
// src/instrumentation.ts). Every few seconds, for each user:
//
// - a check that is live is driven to its end (one at a time: one Computer, one browser);
// - a watch that is due gets its scheduled check, which starts the Computer;
// - a Computer with no check left is stopped, and stays stopped until the next one.
//
// The Computer never wakes itself: this worker is the schedule. One process runs it.
// Several processes would need a lock, or a job queue, around it.

import "server-only";
import { begin, drive, liveCheck, lost } from "./checks";
import { alive, released, stop } from "./pine";
import { read, type UserData } from "./store";

const TICK_MS = 4_000;
/** A watch due this soon keeps the Computer running rather than stopping and starting it. */
const SOON_MS = 45_000;

interface WorkerState {
  driving: Set<string>;
  busy: Set<string>;
  ticks: number;
}

const shared = globalThis as typeof globalThis & { __worker?: WorkerState };

export function startWorker(): void {
  if (shared.__worker) return;
  const state: WorkerState = (shared.__worker = { driving: new Set(), busy: new Set(), ticks: 0 });
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    state.ticks += 1;
    tick(state)
      .catch((error) => console.error("worker:", error))
      .finally(() => (ticking = false));
  }, TICK_MS).unref();
}

async function tick(state: WorkerState): Promise<void> {
  const { users } = await read();
  await Promise.allSettled(Object.entries(users).map(([user, data]) => tickUser(state, user, data)));
}

async function tickUser(state: WorkerState, user: string, data: UserData): Promise<void> {
  if (state.busy.has(user)) return; // a Stop is under way
  const now = Date.now();
  const live = liveCheck(data);

  if (live) {
    if (live.state !== "asking" && !state.driving.has(live.id)) {
      state.driving.add(live.id);
      void drive(user, live.id).finally(() => state.driving.delete(live.id));
    }
    // A question waits for a person, but the Computer doesn't wait for ever: if it
    // idled out, the check ends with it.
    if (live.state === "asking" && state.ticks % 5 === 0 && !(await alive(user))) await lost(user, live.id);
    return;
  }

  // A Start or Stop that a restart of this server cut short: see where it got to.
  if (data.computer && (data.computer.state === "starting" || data.computer.state === "stopping")) {
    if (!(await alive(user))) await released(user);
    else await stopNow(state, user);
    return;
  }

  const due = data.watches
    .filter((w) => w.enabled)
    .map((w) => ({ watch: w, at: Date.parse(w.retryAt ?? w.nextAt) }))
    .sort((a, b) => a.at - b.at)[0];
  if (due && due.at <= now) {
    await begin(user, due.watch.id, "schedule", due.watch.nextAt);
    return; // the next tick drives it
  }

  // Between checks the Computer is stopped. What it knew is already in the store.
  if (data.computer?.state === "running" && !(due && due.at - now < SOON_MS)) await stopNow(state, user);
}

async function stopNow(state: WorkerState, user: string): Promise<void> {
  state.busy.add(user);
  void stop(user)
    .catch((error) => console.error("worker: stop:", error))
    .finally(() => state.busy.delete(user));
}
