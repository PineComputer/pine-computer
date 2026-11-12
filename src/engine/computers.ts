// A drama's Computers and their sessions: create, start, stop, open and close, with the
// records saved around each call the way Pine's best practices ask. Credentials are saved
// before Create, and a Create or Start that fails is retried with the same credentials,
// never with a new identity. One lifecycle action runs at a time per Computer, and each
// reads the Computer's row afresh, since the action before it may have changed it.
import { IDLE_WAITING_S, IDLE_WORKING_S } from "./config.ts";
import { all, get, newId, now, run } from "./db.ts";
import { type Attached, type ComputerRef, type Fleet, type Limits, type SessionRef, isBusy } from "./fleet.ts";
import { publish } from "./live.ts";
import { type ComputerRow, type SessionRow, computer as computerRow, openSessionsOf, raiseCost } from "./records.ts";
import { seal, unseal } from "./seal.ts";

let fleetRef: Fleet | undefined;
const UNKNOWN: Limits = { maxComputers: null, maxIdleSeconds: null, idleAdjustable: true, maxRuntimeSeconds: null };
/** How long a read of the project's limits holds, and how soon one that failed is tried again. */
const LIMITS_HOLD_MS = 10 * 60_000;
const LIMITS_RETRY_MS = 60_000;
/** The project's limits as last read, the read under way, and when they may be read again. */
let limits: Limits | undefined;
let reading: Promise<void> | undefined;
let readAgainAt = 0;

function keepLimits(value: Limits): void {
  limits = value;
  readAgainAt = Date.now() + LIMITS_HOLD_MS;
}

/** The project's limits as last read; none until they are known. */
export function projectLimits(): Limits {
  return limits ?? UNKNOWN;
}

/**
 * Reads the project's limits when the studio connects, and again when a decision rests on
 * them (starting a Computer, or work waiting at the project's limit, which its owner may have
 * raised) and the last read is ten minutes old. Nothing reads them on a timer: a studio with
 * nothing to start asks Pine nothing.
 */
export function freshLimits(): Promise<void> {
  const current = fleetRef;
  if (!current || Date.now() < readAgainAt) return Promise.resolve();
  if (reading) return reading;
  const read: Promise<void> = current
    .limits()
    .then(
      (value) => {
        if (fleetRef === current) keepLimits(value);
      },
      (error) => {
        if (fleetRef === current) readAgainAt = Date.now() + LIMITS_RETRY_MS;
        throw error;
      },
    )
    .finally(() => {
      if (reading === read) reading = undefined;
    });
  reading = read;
  return read;
}

/** An idle timeout the project allows: no longer than its maximum, and at least Pine's minute. */
export function allowedIdle(seconds: number): number {
  const max = projectLimits().maxIdleSeconds;
  return max ? Math.max(60, Math.min(seconds, max)) : seconds;
}

/**
 * The idle timeout a start asks for: the working one, which the clock raises while a session
 * waits on the maker. Where the project can't change it once started (no lifetime policy), the
 * waiting one from the start, so a question still outlasts the maker's break.
 */
async function startIdle(): Promise<number> {
  await freshLimits().catch((error) => console.error("project limits:", message(error)));
  return allowedIdle(projectLimits().idleAdjustable ? IDLE_WORKING_S : IDLE_WAITING_S);
}

/**
 * Uses a fleet from now on, with its project's limits if they were just read. Computers made
 * in another mode or project are out of its reach, so they are marked stopped (replay's vanish
 * anyway; disconnect stops Pine's before switching), and are never started again (claimComputer).
 */
export function setFleet(fleet: Fleet | undefined, known?: Limits): void {
  fleetRef = fleet;
  limits = undefined;
  reading = undefined;
  readAgainAt = 0;
  if (known) keepLimits(known);
  else void freshLimits().catch((error) => console.error("project limits:", message(error)));
  // Running from before projects were kept: disconnecting stops everything, so they are this project's.
  if (fleet) run("update computers set project = ? where project = '' and mode = ? and state in ('starting', 'running', 'stopping')", fleet.project, fleet.mode);
  const others = all<ComputerRow>(
    "select * from computers where state in ('starting', 'running', 'stopping') and (mode != ? or project != ?)",
    fleet?.mode ?? "",
    fleet?.project ?? "",
  );
  for (const row of others) {
    const why = !fleet ? "The studio was disconnected from Pine." : fleet.mode !== row.mode ? `The studio switched to ${fleet.mode === "pine" ? "your Pine project" : "replay"}.` : "The studio switched to another Pine project.";
    markStopped(row, why);
  }
}

export function hasFleet(): boolean {
  return fleetRef !== undefined;
}

export function fleet(): Fleet {
  if (!fleetRef) throw new Error("Connect a Pine project first.");
  return fleetRef;
}

export function computerRef(row: ComputerRow): ComputerRef {
  if (!row.binding) throw new Error(`${row.label} isn't running.`);
  return { id: row.id, credentials: unseal(row.credentials), binding: unseal(row.binding) };
}

export function sessionRef(row: SessionRow): SessionRef {
  if (!row.token) throw new Error("This session has no token.");
  return { name: row.name, token: unseal(row.token) };
}

const locks = new Map<string, Promise<unknown>>();

/** Runs lifecycle actions on one Computer one at a time. */
export function serialized<T>(computerId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(computerId) ?? Promise.resolve();
  const next = previous.then(action, action);
  locks.set(
    computerId,
    next.catch(() => undefined),
  );
  return next;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** After this many failed starts in a row, a Computer waits for the maker to say "try again". */
export const START_ATTEMPTS = 3;

/** Whether a stopped or failed Computer may be started now: failed ones back off, then wait for the maker. */
export function startable(row: ComputerRow): boolean {
  if (row.state === "stopped") return true;
  if (row.state !== "failed" || row.failures >= START_ATTEMPTS) return false;
  return Date.now() - Date.parse(row.updated_at) >= 15_000 * 2 ** (row.failures - 1);
}

function started(id: string, attached: Attached, idle: number): void {
  run(
    "update computers set binding = ?, revision = ?, state = 'running', idle_timeout = ?, stop_by = null, failures = 0, last_error = null, updated_at = ? where id = ?",
    seal(attached.binding),
    attached.revision,
    idle,
    now(),
    id,
  );
}

/** A start that didn't happen. A busy project (at its limit of Computers or starts) waits without counting against the Computer. */
function failedToStart(id: string, error: unknown): void {
  run("update computers set state = 'failed', failures = failures + ?, last_error = ?, updated_at = ? where id = ?", isBusy(error) ? 0 : 1, message(error), now(), id);
}

/** A new Computer for a drama. Resolves once it runs; its row says "starting" meanwhile. */
export async function provision(dramaId: string): Promise<void> {
  const idle = await startIdle();
  const count = get<{ n: number }>("select count(*) as n from computers where drama_id = ?", dramaId)?.n ?? 0;
  const label = `PC-${count + 1}`;
  const { id, credentials } = await fleet().newCredentials();
  run(
    "insert into computers (id, drama_id, mode, project, label, credentials, state, idle_timeout, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?)",
    id,
    dramaId,
    fleet().mode,
    fleet().project,
    label,
    seal(credentials),
    idle,
    now(),
    now(),
  );
  publish(`drama:${dramaId}`);
  await serialized(id, async () => {
    try {
      started(id, await fleet().createComputer(credentials, label, idle), idle);
      await noteStopBy(id);
    } catch (error) {
      failedToStart(id, error);
    }
  });
  publish(`drama:${dramaId}`, "dramas");
}

/**
 * Starts a stopped or failed Computer of the drama from its saved credentials. For one
 * whose Create never answered, the fleet creates it with those same credentials.
 */
export async function restart(row: ComputerRow): Promise<void> {
  run("update computers set state = 'starting', updated_at = ? where id = ?", now(), row.id);
  publish(`drama:${row.drama_id}`);
  await serialized(row.id, async () => {
    const idle = await startIdle();
    try {
      started(row.id, await fleet().startComputer(unseal(row.credentials), row.label, idle), idle);
      await noteStopBy(row.id);
    } catch (error) {
      failedToStart(row.id, error);
    }
  });
  publish(`drama:${row.drama_id}`, "dramas");
}

/** The maker's "try again" after a drama's Computers wouldn't start. */
export function retryStarts(dramaId: string): void {
  run("update computers set failures = 0, updated_at = ? where drama_id = ? and state = 'failed'", new Date(0).toISOString(), dramaId);
  publish(`drama:${dramaId}`, "dramas");
}

/**
 * The Computer is gone: its sessions end with it, and the work they held stops. Episodes
 * and reviews that depended on them say so; nothing claims their files or turns survive.
 */
export function markStopped(row: ComputerRow, why: string): void {
  const sessions = openSessionsOf(row.id);
  run("update computers set state = 'stopped', binding = null, updated_at = ? where id = ?", now(), row.id);
  for (const session of sessions) {
    run("update sessions set state = 'lost', closed_at = ? where id = ?", now(), session.id);
    run("update reviews set state = 'ended' where session_id = ? and state in ('saving', 'open', 'sending')", session.id);
    if (session.episode_id) {
      run(
        "update episodes set state = 'stopped', note = ?, updated_at = ? where id = ? and state in ('working', 'waiting')",
        why,
        now(),
        session.episode_id,
      );
    }
  }
  publish(`drama:${row.drama_id}`, "inbox", "dramas");
}

/**
 * Stops a Computer. It counts as stopped only once Pine says so: a stop that fails leaves it
 * running (and says why), and one still shutting down stays "stopping" until reconcile sees
 * it gone. Throws when the stop failed, so whoever asked can tell the maker.
 */
export async function stop(row: ComputerRow): Promise<void> {
  run("update computers set state = 'stopping', updated_at = ? where id = ?", now(), row.id);
  publish(`drama:${row.drama_id}`);
  await serialized(row.id, async () => {
    const current = computerRow(row.id) ?? row;
    if (!current.binding) {
      markStopped(current, "Its Computer was stopped.");
      return;
    }
    try {
      if (await fleet().stop(computerRef(current))) markStopped(current, "Its Computer was stopped.");
    } catch (error) {
      run("update computers set state = 'running', last_error = ?, updated_at = ? where id = ?", message(error), now(), row.id);
      publish(`drama:${row.drama_id}`);
      throw error;
    }
  });
}

export async function openSession(row: ComputerRow, role: "setup" | "episode", episodeId: string | null, label: string): Promise<SessionRow> {
  return serialized(row.id, async () => {
    const created = await fleet().createSession(computerRef(computerRow(row.id) ?? row), label);
    const id = newId("ses");
    run(
      "insert into sessions (id, computer_id, drama_id, name, token, role, episode_id, state, created_at) values (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
      id,
      row.id,
      row.drama_id,
      created.name,
      seal(created.token),
      role,
      episodeId,
      now(),
    );
    return get<SessionRow>("select * from sessions where id = ?", id)!;
  });
}

/**
 * Before a session closes, its turns are read once more: a charge that settled after its turn
 * (generated video is billed when it is done) may not have reached the studio as an event.
 */
async function lastCosts(row: ComputerRow, session: SessionRow): Promise<void> {
  const turns = all<{ id: string }>("select id from turns where session_id = ? and ended_at is not null order by created_at desc limit 30", session.id);
  for (const turn of turns) {
    const info = await fleet().wait(computerRef(row), sessionRef(session), turn.id, 0).catch(() => undefined);
    if (info) raiseCost(turn.id, info.cost, info.media);
  }
}

export async function closeSession(session: SessionRow): Promise<void> {
  run("update sessions set state = 'closed', closed_at = ? where id = ?", now(), session.id);
  const row = computerRow(session.computer_id);
  if (!row?.binding) return;
  if (session.state === "open" && session.token) await lastCosts(row, session);
  await serialized(row.id, () => fleet().closeSession(computerRef(row), session.name)).catch(() => undefined);
}

export async function setIdle(row: ComputerRow, seconds: number): Promise<void> {
  const applied = await serialized(row.id, () => fleet().setIdleTimeout(computerRef(row), seconds));
  run("update computers set idle_timeout = ?, updated_at = ? where id = ?", applied, now(), row.id);
}

/**
 * Keeps when Pine will stop a running Computer for its running time; a Computer that can't say
 * is taken to have no limit. A project with no limit on running time has nothing to tell, so
 * its Computers aren't asked (reconcile would otherwise ask each one every minute).
 */
export async function noteStopBy(id: string): Promise<void> {
  const row = computerRow(id);
  if (row?.state !== "running" || !row.binding || projectLimits().maxRuntimeSeconds === null) return;
  const stopBy = await fleet()
    .stopBy(computerRef(row))
    .catch((error) => void console.error(`${row.label} lifetime:`, message(error)));
  run("update computers set stop_by = ? where id = ?", stopBy ? stopBy.toISOString() : null, id);
}

/** Running time kept free at the end of a start: enough for a turn to finish and its episode to stop at a review. */
const RETIRE_BEFORE_MS = 6 * 60 * 60_000;

/**
 * Whether a Computer is near the end of its running time: it takes no new session, and stops
 * once its last one closes, to start again with a fresh allowance. On a project whose starts
 * run less than twice that, the last half of each start.
 */
export function retiring(row: ComputerRow): boolean {
  if (!row.stop_by) return false;
  const runtime = projectLimits().maxRuntimeSeconds;
  const margin = Math.min(RETIRE_BEFORE_MS, runtime ? (runtime * 1000) / 2 : RETIRE_BEFORE_MS);
  return Date.now() >= Date.parse(row.stop_by) - margin;
}

export function runningComputers(dramaId?: string): ComputerRow[] {
  return dramaId
    ? all<ComputerRow>("select * from computers where drama_id = ? and state = 'running' order by created_at", dramaId)
    : all<ComputerRow>("select * from computers where state = 'running' order by created_at");
}
