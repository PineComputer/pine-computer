// The production line's clock. Every couple of seconds: start each new drama's setup;
// fill free slots from each drama's episode queue (episodes at once, episodes per Computer,
// and a cap on episodes waiting for the maker); keep idle timeouts long while a session
// waits on the maker; stop Computers with nothing to do; retry what didn't go through.
import { IDLE_WAITING_S, IDLE_WORKING_S, WAITING_CAP } from "./config.ts";
import {
  START_ATTEMPTS,
  allowedIdle,
  closeSession,
  computerRef,
  fleet,
  freshLimits,
  hasFleet,
  markStopped,
  noteStopBy,
  openSession,
  projectLimits,
  provision,
  restart,
  retiring,
  runningComputers,
  setIdle,
  startable,
  stop,
} from "./computers.ts";
import { all, get, now, run } from "./db.ts";
import { followEvents, followTurn, isFollowed, unsettledTurns } from "./follow.ts";
import { DRAMA_SKILL, episodeGoal, projectScreenplay, rehearsed, resumeGoal, setupGoal } from "./goals.ts";
import type { FileRow } from "./library.ts";
import { publish } from "./live.ts";
import { type ComputerRow, type DramaRow, type EpisodeRow, type SessionRow, computer as computerRow, episodeCode, latestTurn, openSessionsOf, session as sessionRow } from "./records.ts";
import { approveUnreviewed, reconcileSending } from "./reviews.ts";
import { noteDramaSkill } from "./settings.ts";
import { attach, attachKit, episodeArchive, hasRun, inputs, projectArchive, references, sendRun, startRun, unconfirmedRuns } from "./runs.ts";

/** Work the clock started and hasn't finished, so a slow call never starts twice. */
const busy = new Set<string>();

/** While the maker disconnects, the clock starts nothing new. */
let paused = false;

export function pause(): void {
  paused = true;
}

export function resume(): void {
  paused = false;
}

/** Resolves once the work the clock started has finished, or after a minute. */
export async function drain(): Promise<void> {
  const until = Date.now() + 60_000;
  while (busy.size && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200));
}

function once(key: string, work: () => Promise<void>): boolean {
  if (busy.has(key)) return false;
  busy.add(key);
  void work()
    .catch((error) => console.error(`${key}:`, (error as Error).message))
    .finally(() => busy.delete(key));
  return true;
}

/** Work that failed lately (an episode's start, a setup's, a run's resend), so it waits before it's tried again. */
const failures = new Map<string, { count: number; at: number }>();

/** Whether failed work still waits: 15 s after the first failure, doubling, at most 5 minutes. */
function backingOff(key: string): boolean {
  const failed = failures.get(key);
  return failed !== undefined && Date.now() - failed.at < Math.min(5 * 60_000, 15_000 * 2 ** (failed.count - 1));
}

/** Counts a failure; returns how many in a row. */
function failedAgain(key: string): number {
  const count = (failures.get(key)?.count ?? 0) + 1;
  failures.set(key, { count, at: Date.now() });
  return count;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sessions being opened on each Computer, counted with its open ones so two episodes never claim one slot. */
const opening = new Map<string, number>();

function load(computerId: string): number {
  return openSessionsOf(computerId).length + (opening.get(computerId) ?? 0);
}

function reserve(computerId: string): () => void {
  opening.set(computerId, (opening.get(computerId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    opening.set(computerId, (opening.get(computerId) ?? 1) - 1);
  };
}

function capacity(drama: DramaRow): number {
  return Math.max(1, Math.ceil(drama.parallel / Math.max(1, drama.per_computer)));
}

/** A running Computer of the drama with room for one more session, and running time left for it, or none. */
function freeComputer(drama: DramaRow): ComputerRow | undefined {
  return runningComputers(drama.id).find((computer) => !retiring(computer) && load(computer.id) < Math.max(1, drama.per_computer));
}

/** New Computers asked for whose rows aren't saved yet (their credentials are being made): they count against the limit too. */
let provisioning = 0;

/** Whether the studio already has as many Computers going as the project allows. */
export function atProjectLimit(): boolean {
  const max = projectLimits().maxComputers;
  if (max === null) return false;
  const live = get<{ n: number }>("select count(*) as n from computers where mode = ? and state in ('starting', 'running', 'stopping')", fleet().mode)?.n ?? 0;
  return live + provisioning >= max;
}

/**
 * A Computer the drama can use soon: a free running one, or one it starts now (while the
 * project allows another; otherwise the work waits its turn). A stopped or
 * failed one is started again before any new one is made, so a Create whose answer was
 * lost is retried as the same Computer; one that keeps failing waits for the maker.
 */
function claimComputer(drama: DramaRow): ComputerRow | undefined {
  const free = freeComputer(drama);
  if (free) return free;
  const pool = all<ComputerRow>("select * from computers where drama_id = ? and mode = ? and state in ('starting', 'running', 'stopping')", drama.id, drama.mode);
  if (pool.some((computer) => computer.state === "starting")) return undefined;
  if (pool.length >= capacity(drama)) return undefined;
  if (atProjectLimit()) {
    // The work waits; the limit is read again now and then, in case the project now allows more.
    void freshLimits().catch((error) => console.error("project limits:", message(error)));
    return undefined;
  }
  // Only Computers made in this project can start here; one from another project is left alone.
  const idle = all<ComputerRow>(
    "select * from computers where drama_id = ? and mode = ? and project = ? and state in ('stopped', 'failed') order by created_at",
    drama.id,
    drama.mode,
    fleet().project,
  );
  if (idle.length) {
    const next = idle.find(startable);
    if (next) once(`start:${drama.id}`, () => restart(next));
    return undefined;
  }
  if (busy.has(`start:${drama.id}`)) return undefined;
  provisioning += 1;
  once(`start:${drama.id}`, () => provision(drama.id).finally(() => (provisioning -= 1)));
  return undefined;
}

/**
 * Whether the session's Computer offers Pine's drama skill. Without it the agent would make
 * up a drama of its own at the project's expense. The skill comes with the project, so the
 * setup's Computer answers for every Computer the drama uses after it, and the studio
 * remembers the answer for the project (New drama offers a rehearsal without it). One that
 * can't list its skills (an older release) isn't held back on that account.
 */
async function offersDramaSkill(session: SessionRow): Promise<boolean> {
  const computer = computerRow(session.computer_id);
  if (!computer?.binding) return true;
  try {
    const offered = (await fleet().skills(computerRef(computer))).includes(DRAMA_SKILL);
    if (noteDramaSkill(fleet().project, offered)) publish("app");
    return offered;
  } catch (error) {
    console.error("skills:", message(error));
    return true;
  }
}

/**
 * Holds the drama: for want of the drama skill, nothing new starts until the maker tries again
 * or rehearses; for want of its inputs (choose-inputs), until the maker chooses them.
 */
async function hold(drama: DramaRow, session: SessionRow, reason: "no-drama-skill" | "choose-inputs"): Promise<void> {
  run("update dramas set status = 'stopped', reason = ?, note = '', updated_at = ? where id = ?", reason, now(), drama.id);
  await closeSession(session);
  publish(`drama:${drama.id}`, "dramas");
}

/** The drama's screenplay as its sessions name it in the project (goals.ts, projectScreenplay); undefined before the studio chose the inputs. */
function screenplayOf(drama: DramaRow): string | undefined {
  const file = drama.screenplay_file === null ? undefined : get<FileRow>("select * from files where id = ?", drama.screenplay_file);
  return file && projectScreenplay(file.name);
}

/** A goal as the drama gives it: rehearsed, with the stand-in kit, when the drama is a rehearsal. */
function goalOf(drama: DramaRow, goal: string): string {
  return drama.rehearsal ? rehearsed(goal) : goal;
}

/**
 * Hands the setup session the screenplay and its goal: on a new session, or again on one
 * whose start didn't finish. A rehearsal needs no drama skill; it gets the stand-in kit.
 */
async function beginSetup(drama: DramaRow, session: SessionRow): Promise<void> {
  if (!(await offersDramaSkill(session)) && !drama.rehearsal) {
    await hold(drama, session, "no-drama-skill");
    return;
  }
  // A drama made before New drama asked for drama-cli init's inputs waits for the maker to choose them.
  const files = inputs(drama.id);
  const brief = files.find((file) => file.kind === "brief");
  if (!files.some((file) => file.id === drama.screenplay_file) || !brief || !drama.screenplay_language || (!drama.rehearsal && !drama.preset)) {
    await hold(drama, session, "choose-inputs");
    return;
  }
  const { sent, names } = await attach(session, files);
  if (drama.rehearsal) await attachKit(session);
  await startRun(session, "setup", goalOf(drama, setupGoal(drama, sent, { screenplay: names[drama.screenplay_file!], brief: names[brief.id] })));
}

/**
 * A setup that didn't start is tried again, a few times, then the drama stops and says why.
 * A session it half opened is let go, so its Computer can stop.
 */
function setupFailed(drama: DramaRow, error: unknown): void {
  const key = `setup:${drama.id}`;
  if (failedAgain(key) < START_ATTEMPTS) return;
  failures.delete(key);
  run("update dramas set status = 'stopped', note = ?, updated_at = ? where id = ?", message(error), now(), drama.id);
  const open = get<SessionRow>("select * from sessions where drama_id = ? and role = 'setup' and state = 'open'", drama.id);
  if (open && !hasRun(open.id)) void closeSession(open);
}

function ensureSetup(drama: DramaRow): void {
  const key = `setup:${drama.id}`;
  if (backingOff(key)) return;
  const open = get<SessionRow>("select * from sessions where drama_id = ? and role = 'setup' and state = 'open'", drama.id);
  if (open) {
    if (!hasRun(open.id)) {
      once(key, () =>
        beginSetup(drama, open)
          .then(() => void failures.delete(key))
          .catch((error) => {
            setupFailed(drama, error);
            throw error;
          })
          .finally(() => publish(`drama:${drama.id}`)),
      );
    }
    return;
  }
  const computer = claimComputer(drama);
  if (!computer) return;
  const release = reserve(computer.id);
  const started = once(`setup:${drama.id}`, async () => {
    try {
      const session = await openSession(computer, "setup", null, "Setup");
      release();
      await beginSetup(drama, session);
      failures.delete(key);
    } catch (error) {
      setupFailed(drama, error);
      throw error;
    } finally {
      release();
      publish(`drama:${drama.id}`);
    }
  });
  if (!started) release();
}

function startEpisode(drama: DramaRow, episode: EpisodeRow, computer: ComputerRow): void {
  run("update episodes set state = 'working', note = case when resume = 1 then note else '' end, updated_at = ? where id = ?", now(), episode.id);
  const release = reserve(computer.id);
  const started = once(`episode:${episode.id}`, async () => {
    let session: SessionRow | undefined;
    try {
      const code = episodeCode(episode);
      session = await openSession(computer, "episode", episode.id, code);
      release();
      // A project can lose the skill after its setup: the drama waits rather than the agent improvising each episode.
      if (!drama.rehearsal && !(await offersDramaSkill(session))) {
        run("update episodes set state = 'queued', session_id = null, updated_at = ? where id = ?", now(), episode.id);
        await hold(drama, session, "no-drama-skill");
        return;
      }
      run("update episodes set session_id = ?, updated_at = ? where id = ?", session.id, now(), episode.id);
      // The project pre-production handed over, and on a resume the episode's own packed folder;
      // a drama set up before pre-production existed gets its references as loose files.
      const project = projectArchive(drama.id);
      const handoff = project.length > 0;
      let files: FileRow[] = handoff ? project : [...inputs(drama.id), ...references(drama.id)];
      if (episode.resume) {
        const own = handoff ? episodeArchive(episode.id) : [];
        files = [...files, ...(own.length || handoff ? own : all<FileRow>("select * from files where episode_id = ? and kind != 'observation' order by id", episode.id))];
      }
      const { sent, skipped } = await attach(session, files);
      if (skipped.length) console.warn(`${code}: too large to hand over (over 64 MiB): ${skipped.join(", ")}`);
      if (drama.rehearsal) await attachKit(session);
      const goal = episode.resume
        ? resumeGoal(drama, code, sent, handoff, episode.carry || undefined, screenplayOf(drama))
        : episodeGoal(drama, code, sent, handoff, screenplayOf(drama));
      await startRun(session, episode.resume ? "resume" : "episode", goalOf(drama, goal));
      run("update episodes set resume = 0, carry = '', continues = 0, note = '', updated_at = ? where id = ?", now(), episode.id);
      failures.delete(episode.id);
    } catch (error) {
      // A run that was saved is resent with its own key (unconfirmedRuns), so the episode keeps
      // its session. Before that, the half-opened session is let go and the episode waits its
      // turn again, after a pause; one that won't start after a few tries waits for the maker.
      if (!session || !hasRun(session.id)) {
        if (session) await closeSession(session);
        if (failedAgain(episode.id) >= START_ATTEMPTS) {
          failures.delete(episode.id);
          run("update episodes set state = 'failed', note = ?, session_id = null, updated_at = ? where id = ?", message(error), now(), episode.id);
        } else {
          run("update episodes set state = 'queued', session_id = null, updated_at = ? where id = ?", now(), episode.id);
        }
      }
      throw error;
    } finally {
      release();
      publish(`drama:${drama.id}`);
    }
  });
  if (!started) release();
}

/**
 * Episodes whose start was cut short (the engine stopped after it opened their session but
 * before their run was saved): the half-open session is let go and they wait their turn again.
 */
function recoverStarts(drama: DramaRow): void {
  for (const episode of all<EpisodeRow>("select * from episodes where drama_id = ? and state = 'working'", drama.id)) {
    if (busy.has(`episode:${episode.id}`)) continue;
    const session = episode.session_id ? sessionRow(episode.session_id) : undefined;
    if (session && (session.state !== "open" || hasRun(session.id))) continue;
    if (session) void closeSession(session);
    run("update episodes set state = 'queued', session_id = null, updated_at = ? where id = ? and state = 'working'", now(), episode.id);
    publish(`drama:${drama.id}`);
  }
}

function fill(drama: DramaRow): void {
  recoverStarts(drama);
  const count = (state: string) => get<{ n: number }>("select count(*) as n from episodes where drama_id = ? and state = ?", drama.id, state)?.n ?? 0;
  let active = count("working") + count("waiting");
  const waiting = count("waiting");
  const queued = all<EpisodeRow>("select * from episodes where drama_id = ? and state = 'queued' order by number", drama.id);
  for (const episode of queued) {
    if (active >= drama.parallel || waiting >= WAITING_CAP) return;
    if (backingOff(episode.id)) continue;
    const computer = claimComputer(drama);
    if (!computer) return;
    startEpisode(drama, episode, computer);
    active += 1;
  }
  if (!queued.length && !active && count("stopped") + count("failed") === 0) {
    const total = get<{ n: number }>("select count(*) as n from episodes where drama_id = ?", drama.id)?.n ?? 0;
    if (total) {
      run("update dramas set status = 'done', updated_at = ? where id = ?", now(), drama.id);
      publish(`drama:${drama.id}`, "dramas");
    }
  }
}

/** Computers whose idle timeout Pine refused to change, and when to ask again. */
const idleRefused = new Map<string, number>();

/**
 * A Computer waiting on the maker keeps running longer, within what the project allows; one
 * with nothing to do stops (and a stop that failed is tried again a minute later), as does
 * one near the end of its running time once its sessions close, to start again afresh.
 */
function tend(computer: ComputerRow): void {
  const sessions = openSessionsOf(computer.id);
  const waiting = sessions.some((session) => get("select id from reviews where session_id = ? and state in ('saving', 'open') limit 1", session.id) !== undefined);
  const desired = allowedIdle(waiting ? IDLE_WAITING_S : IDLE_WORKING_S);
  if (projectLimits().idleAdjustable && computer.idle_timeout !== desired && (idleRefused.get(computer.id) ?? 0) < Date.now()) {
    // Refused, or applied as something else: asked again only ten minutes later.
    const later = () => idleRefused.set(computer.id, Date.now() + 10 * 60_000);
    once(`idle:${computer.id}`, () =>
      setIdle(computer, desired).then(
        () => void (computerRow(computer.id)?.idle_timeout !== desired && later()),
        (error) => {
          later();
          throw error;
        },
      ),
    );
  }
  if (!sessions.length) {
    const drama = get<DramaRow>("select * from dramas where id = ?", computer.drama_id);
    const queued = get<{ n: number }>("select count(*) as n from episodes where drama_id = ? and state = 'queued'", computer.drama_id)?.n ?? 0;
    const triedLately = computer.last_error !== null && Date.now() - Date.parse(computer.updated_at) < 60_000;
    const done = drama && drama.status !== "setup" && !queued;
    if (drama && (done || retiring(computer)) && !opening.get(computer.id) && !triedLately) once(`stop:${computer.id}`, () => stop(computer));
  }
}

/** Every saved Computer against Pine: those that stopped are marked so; running turns are followed again. */
export async function reconcile(): Promise<void> {
  if (!hasFleet()) return;
  for (const computer of all<ComputerRow>("select * from computers where state in ('running', 'starting', 'stopping') and mode = ?", fleet().mode)) {
    if (!computer.binding) {
      if (computer.state !== "running") markStopped(computer, "Its Computer didn't finish starting.");
      continue;
    }
    const state = await fleet().status(computerRef(computer)).catch(() => "unknown");
    if (state === "stopped" || state === "failed") {
      markStopped(computer, "Its Computer stopped.");
      continue;
    }
    if (state !== "running") continue;
    // A stop that was still shutting down when the engine went away, but didn't: tend tries again.
    if (computer.state === "stopping") run("update computers set state = 'running', updated_at = ? where id = ?", now(), computer.id);
    // Started before the studio kept running time (or before Pine reported it).
    if (!computer.stop_by) await noteStopBy(computer.id);
    for (const session of openSessionsOf(computer.id)) {
      followEvents(session.id);
      const turn = latestTurn(session.id);
      // Answered, but the turn the answer opened was never recorded (the engine stopped in between): follow that one.
      if (turn?.state === "answered" && turn.next_turn_id) followTurn(session.id, turn.next_turn_id);
      else if (turn && !turn.ended_at && turn.state !== "answered") followTurn(session.id, turn.id);
    }
  }
  await reconcileSending();
  await approveUnreviewed();
  publish("dramas", "inbox");
}

export function tick(): void {
  if (!hasFleet() || paused) return; // nothing to run on until the maker connects a project or chooses replay
  // Only the dramas made for this mode: a replay drama never starts a Pine Computer.
  for (const drama of all<DramaRow>("select * from dramas where status in ('setup', 'production') and mode = ?", fleet().mode)) {
    if (drama.status === "setup") ensureSetup(drama);
    else fill(drama);
  }
  for (const computer of runningComputers()) tend(computer);
  for (const turn of unsettledTurns()) if (!isFollowed(turn.id)) followTurn(turn.session_id, turn.id);
  for (const key of unconfirmedRuns()) {
    // Resent with the same key until Pine confirms it, pausing longer after each failure.
    if (backingOff(`run:${key}`)) continue;
    once(`run:${key}`, () =>
      sendRun(key).then(
        () => void failures.delete(`run:${key}`),
        (error) => {
          failedAgain(`run:${key}`);
          throw error;
        },
      ),
    );
  }
}

const clock = globalThis as typeof globalThis & { __studioClock?: NodeJS.Timeout[] };

export function startClock(intervalMs = 2_000): void {
  if (clock.__studioClock) return;
  let reconciling = false;
  const reconcileNow = () => {
    if (reconciling) return;
    reconciling = true;
    reconcile()
      .catch((error) => console.error("reconcile:", (error as Error).message))
      .finally(() => (reconciling = false));
  };
  reconcileNow();
  const ticking = setInterval(() => {
    try {
      tick();
    } catch (error) {
      console.error("tick:", (error as Error).message);
    }
  }, intervalMs);
  const reconciliation = setInterval(reconcileNow, 60_000);
  reconciliation.unref();
  clock.__studioClock = [ticking, reconciliation];
}

export function stopClock(): void {
  for (const timer of clock.__studioClock ?? []) clearInterval(timer);
  clock.__studioClock = undefined;
}
