// The work that happens with no page open, in the server process (started from
// src/instrumentation.ts). Every few seconds, for each user:
//
// - each running turn is followed until it ends, then recorded with its files;
// - a schedule that's due fires, starting the Computer if it must;
// - a site's request to create a passkey is passed to the user's open pages.
//
// One process runs it. Several processes would need a lock, or a job queue, around it.

import "server-only";
import { publish } from "./live";
import { computer, overview, released, session } from "./pine";
import { fire } from "./schedules";
import { read, type UserData } from "./store";
import { sync } from "./turns";
import type { Ceremony } from "@/shared/api";

const TICK_MS = 4_000;
const LIVE = new Set(["running", "canceling"]);

interface WorkerState {
  following: Set<string>;
  firing: Set<string>;
  ceremonies: Map<string, Ceremony[]>;
}

const shared = globalThis as typeof globalThis & { __worker?: WorkerState };

export function startWorker(): void {
  if (shared.__worker) return;
  const state: WorkerState = (shared.__worker = { following: new Set(), firing: new Set(), ceremonies: new Map() });
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick(state)
      .catch((error) => console.error("worker:", error))
      .finally(() => (ticking = false));
  }, TICK_MS).unref();
}

/** The passkey requests the worker last saw for a user, for a page that just opened. */
export function pendingCeremonies(user: string): Ceremony[] {
  return shared.__worker?.ceremonies.get(user) ?? [];
}

async function tick(state: WorkerState): Promise<void> {
  const { users } = await read();
  await Promise.allSettled(Object.entries(users).map(([user, data]) => tickUser(state, user, data)));
}

async function tickUser(state: WorkerState, user: string, data: UserData): Promise<void> {
  const now = Date.now();
  for (const schedule of data.schedules) {
    if (!schedule.enabled || state.firing.has(schedule.id)) continue;
    if (Date.parse(schedule.retryAt ?? schedule.nextAt) > now) continue;
    state.firing.add(schedule.id);
    void fire(user, schedule.id, schedule.nextAt)
      .catch(() => undefined) // recorded on the schedule
      .finally(() => state.firing.delete(schedule.id));
  }

  if (!data.computer?.binding) return;

  for (const turn of data.turns) {
    if (!LIVE.has(turn.state) || state.following.has(turn.turnId)) continue;
    state.following.add(turn.turnId);
    void follow(user, turn.session, turn.turnId).finally(() => state.following.delete(turn.turnId));
  }

  await watchPasskeys(state, user);
}

/** Waits a while for the turn to end and records it; the next tick carries on if it hasn't. */
async function follow(user: string, name: string, turnId: string): Promise<void> {
  const target = await session(user, name);
  if (!target) return;
  try {
    const record = await sync(user, target, turnId, 25_000);
    if (record?.files && record.state === "completed") {
      publish(user, { type: "notice", tone: "done", text: record.kind === "schedule" ? "A scheduled task finished" : "A task finished", href: `/s/${name}` });
    } else if (record?.files && record.state === "needs_input") {
      publish(user, { type: "notice", tone: "info", text: `${record.kind === "schedule" ? "A scheduled task" : "A task"} needs your answer`, href: `/s/${name}` });
    }
  } catch (error) {
    // The sandbox went away (it idled out, or stopped elsewhere): its turns end with it.
    if ((await overview(user).catch(() => null))?.state === "stopped") await released(user);
    else console.error("worker: following a turn:", error);
  }
}

async function watchPasskeys(state: WorkerState, user: string): Promise<void> {
  const found = await computer(user);
  if (!found) return;
  const pending = await found.pendingPasskeyCeremonies().catch(() => null);
  if (!pending) return;
  const ceremonies: Ceremony[] = pending.map((c) => ({
    id: c.id,
    rpId: c.rpId,
    origin: c.origin,
    userName: c.userDisplayName || c.userName,
    session: c.session,
    expiresAt: c.expiresAt?.toISOString(),
  }));
  const before = (state.ceremonies.get(user) ?? []).map((c) => c.id).join();
  state.ceremonies.set(user, ceremonies);
  if (ceremonies.map((c) => c.id).join() !== before) publish(user, { type: "passkeys", ceremonies });
}
