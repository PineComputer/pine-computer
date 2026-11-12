// Tasks that run on their own: every so many minutes, or each day (or weekday) at a
// time. The worker fires them; firing starts or resumes the Computer when it must, and
// each run's idempotency key names its slot, so a slot never runs twice.

import "server-only";
import { randomBytes } from "node:crypto";
import type { Session } from "@pinesandbox/computer";
import type { Cadence } from "@/shared/api";
import { HttpError, words } from "./http";
import { publish } from "./live";
import { openSession, overview, released, requireComputer, session, start } from "./pine";
import { readUser, updateUser, type ScheduleRecord } from "./store";
import { recordStarted } from "./turns";
import { secretValues } from "./vault";
import { next, validCadence } from "@/shared/cadence";

export async function createSchedule(user: string, input: Partial<Pick<ScheduleRecord, "label" | "session" | "goal" | "cadence">>): Promise<ScheduleRecord> {
  const goal = input.goal?.trim();
  if (!goal) throw new HttpError(400, "Describe the task it runs.");
  const cadence = input.cadence;
  if (!cadence || !validCadence(cadence)) throw new HttpError(400, "Choose how often it runs: every 15 minutes or more, or a time of day.");
  const data = await readUser(user);
  const target = data.sessions.find((s) => s.name === input.session) ?? data.sessions[0];
  const record: ScheduleRecord = {
    id: `sch_${randomBytes(5).toString("hex")}`,
    label: input.label?.trim() || goal.slice(0, 48),
    session: target?.name ?? "main",
    goal,
    cadence,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextAt: next(cadence, new Date()).toISOString(),
  };
  await updateUser(user, (d) => void d.schedules.push(record));
  return record;
}

export async function setEnabled(user: string, id: string, enabled: boolean): Promise<void> {
  await updateUser(user, (data) => {
    const schedule = data.schedules.find((s) => s.id === id);
    if (!schedule) throw new HttpError(404, "There's no such schedule.");
    schedule.enabled = enabled;
    delete schedule.retryAt;
    // Turned back on, it runs at its next time from now, not at the ones it missed.
    if (enabled) schedule.nextAt = next(schedule.cadence, new Date()).toISOString();
  });
}

export async function deleteSchedule(user: string, id: string): Promise<void> {
  await updateUser(user, (data) => {
    data.schedules = data.schedules.filter((s) => s.id !== id);
  });
}

/** How long a slot keeps trying (a busy session, a Computer that wouldn't start) before it's skipped. */
const RETRY_MS = 2 * 60_000;
const GIVE_UP_MS = 30 * 60_000;

/**
 * Runs a schedule's task for `slot`: its due time, or "now-…" for Run now (which leaves
 * the next time as it was).
 */
export async function fire(user: string, id: string, slot: string): Promise<void> {
  const schedule = (await readUser(user)).schedules.find((s) => s.id === id);
  if (!schedule) throw new HttpError(404, "There's no such schedule.");
  const runKey = `${schedule.id}@${slot}`;
  try {
    const target = await ready(user, schedule.session, schedule.label);
    const turn = await target.agent.run(schedule.goal, { idempotencyKey: runKey, secrets: await secretValues(user) });
    await recordStarted(user, target.name, turn, { kind: "schedule", ask: schedule.goal, runKey, scheduleId: schedule.id });
    await updateUser(user, (data) => {
      const s = data.schedules.find((x) => x.id === id);
      if (!s) return;
      Object.assign(s, { lastAt: new Date().toISOString(), lastTurnId: turn.turnId, lastError: undefined, retryAt: undefined });
      if (slot === s.nextAt) s.nextAt = next(s.cadence, new Date()).toISOString();
    });
    publish(user, { type: "notice", tone: "info", text: `Started “${schedule.label}”`, href: `/s/${target.name}` });
  } catch (error) {
    const reason = error instanceof Error ? words(error.message) : "It didn't start.";
    await updateUser(user, (data) => {
      const s = data.schedules.find((x) => x.id === id);
      if (!s) return;
      s.lastError = reason;
      if (slot !== s.nextAt) return;
      const late = Date.now() - Date.parse(slot) > GIVE_UP_MS;
      s.retryAt = late ? undefined : new Date(Date.now() + RETRY_MS).toISOString();
      if (late) s.nextAt = next(s.cadence, new Date()).toISOString();
    });
    publish(user, { type: "notice", tone: "failed", text: `“${schedule.label}” didn't start: ${reason}`, href: "/schedules" });
    if (slot.startsWith("now-")) throw error;
  }
}

/** The session to run in, starting or resuming the Computer and opening the session as needed. */
async function ready(user: string, name: string, label: string): Promise<Session> {
  const view = await overview(user);
  if (!view) throw new Error("There's no Computer to run it on.");
  if (view.state === "paused") {
    await (await requireComputer(user)).resume();
  } else if (view.state !== "running") {
    await released(user);
    await start(user);
  }
  return (await session(user, name)) ?? openSession(user, await requireComputer(user), name, label);
}
