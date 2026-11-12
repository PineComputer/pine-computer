// Follows the agents' work: each turn to its end, and each open session's events for the
// chat and the crew view. When a turn ends, its files are copied into the library before
// anything else happens, because the next turn can change them (plan, rule 1).
import type { FileKind } from "../shared/types.ts";
import { ENDED, type TurnInfo } from "./fleet.ts";
import { computerRef, fleet, markStopped, sessionRef } from "./computers.ts";
import { all, get, now, run, transaction } from "./db.ts";
import { VERDICT_KINDS, save, seenBefore } from "./library.ts";
import { publish } from "./live.ts";
import { classify, namedPaths, typeOf } from "./classify.ts";
import { onEnded, stopsForMaker } from "./flow.ts";
import { approveUnreviewed, questionAsked, questionReady } from "./reviews.ts";
import { type SessionRow, type TurnRow, computer as computerRow, costRaised, raiseCost, episode as episodeRow, episodeCode, session as sessionRow } from "./records.ts";

const turnsFollowed = new Map<string, Promise<void>>();
const eventsFollowed = new Map<string, AbortController>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Saves what Pine says about a turn. A new turn clears the session's last progress line, which was the turn before's. */
export function recordTurn(sessionId: string, info: TurnInfo): void {
  const ended = ENDED.has(info.state);
  if (!ended && !get("select id from turns where id = ?", info.turnId)) run("update sessions set activity = null where id = ?", sessionId);
  run(
    `insert into turns (id, session_id, state, question, summary, cost, media, next_turn_id, created_at, ended_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set state = excluded.state, question = excluded.question, summary = excluded.summary,
       ${costRaised("excluded")}, next_turn_id = excluded.next_turn_id, ended_at = coalesce(turns.ended_at, excluded.ended_at)`,
    info.turnId,
    sessionId,
    info.state,
    info.question,
    info.summary,
    info.cost,
    info.media,
    info.nextTurnId || null,
    now(),
    ended ? now() : null,
  );
}

export function followTurn(sessionId: string, turnId: string): void {
  if (turnsFollowed.has(turnId)) return;
  const following = loop(sessionId, turnId).finally(() => turnsFollowed.delete(turnId));
  turnsFollowed.set(turnId, following);
}

export function isFollowed(turnId: string): boolean {
  return turnsFollowed.has(turnId);
}

async function loop(sessionId: string, firstTurn: string): Promise<void> {
  let turnId = firstTurn;
  let failures = 0;
  for (;;) {
    const session = sessionRow(sessionId);
    const computer = session && computerRow(session.computer_id);
    if (!session || session.state !== "open" || computer?.state !== "running") return;
    let info: TurnInfo;
    try {
      info = await fleet().wait(computerRef(computer), sessionRef(session), turnId, 25_000);
      failures = 0;
    } catch (error) {
      failures += 1;
      if ((await fleet().status(computerRef(computer)).catch(() => "unknown")) === "stopped") {
        markStopped(computer, "Its Computer stopped.");
        return;
      }
      console.error(`follow ${turnId}:`, (error as Error).message);
      await sleep(Math.min(30_000, 2_000 * failures));
      continue;
    }
    recordTurn(sessionId, info);
    if (info.state === "answered" && info.nextTurnId) {
      // Someone answered it (the maker, just now): the flow has moved on; follow what it opened.
      run("update turns set settled = 1 where id = ?", turnId);
      turnId = info.nextTurnId;
      continue;
    }
    if (ENDED.has(info.state)) {
      await settle(sessionId, info);
      return;
    }
  }
}

/** VERDICT_KINDS as an SQL list. */
const REVIEWED = VERDICT_KINDS.map((kind) => `'${kind}'`).join(", ");

function known(dramaId: string, relPath: string): boolean {
  return get("select id from files where drama_id = ? and rel_path = ? limit 1", dramaId, relPath) !== undefined;
}

/** What the walk below brings in: what the maker reviews, and the documents they read. */
const MADE: FileKind[] = [...VERDICT_KINDS, "bible", "breakdown"];

/**
 * Pictures, clips and documents the agent made in its own folders (an episode's; for the
 * setup, the drama's bible, assets and breakdowns) that the studio doesn't have: for a stop,
 * or a finished turn, that neither returned nor named any of it. Listed a folder at a time, a
 * few hundred at most.
 */
async function made(session: SessionRow): Promise<string[]> {
  const computer = computerRow(session.computer_id)!;
  const episode = session.episode_id ? episodeRow(session.episode_id) : undefined;
  const folders = episode ? [`drama/episodes/${episodeCode(episode)}`] : ["drama/bible", "drama/assets", "drama/episodes"];
  const found: string[] = [];
  for (let listed = 0; folders.length && listed < 300; listed += 1) {
    const entries = await fleet()
      .listFiles(computerRef(computer), sessionRef(session), folders.shift()!)
      .catch((error: { status?: number }) => {
        if (error.status === 404) return []; // no such folder
        throw error;
      });
    for (const entry of entries) {
      if (entry.folder) folders.push(entry.path);
      else if (MADE.includes(classify(entry.path).kind) && !known(session.drama_id, entry.path)) found.push(entry.path);
    }
  }
  return found;
}

/** The screenplay versions drama-cli recorded in the setup's project, and their reviews, that the studio doesn't have yet. */
async function screenplayVersions(session: SessionRow): Promise<string[]> {
  const computer = computerRow(session.computer_id)!;
  const folders = ["drama/screenplay"];
  const found: string[] = [];
  while (folders.length) {
    const entries = await fleet()
      .listFiles(computerRef(computer), sessionRef(session), folders.shift()!)
      .catch((error: { status?: number }) => {
        if (error.status === 404) return []; // no screenplay validated yet
        throw error;
      });
    for (const entry of entries) {
      if (entry.folder) folders.push(entry.path);
      else if (["screenplay-version", "screenplay-review"].includes(classify(entry.path).kind) && !known(session.drama_id, entry.path)) found.push(entry.path);
    }
  }
  return found;
}

/**
 * A turn ended: save its files, then let the flow act on how it ended. Each step is marked
 * when done, so a turn the engine stopped halfway through is taken up again where it was. A
 * stop for the maker becomes a review; its files are the ones the turn returned and any its
 * question names but didn't return.
 */
export async function settle(sessionId: string, info: TurnInfo): Promise<void> {
  const session = sessionRow(sessionId)!;
  const turn = get<TurnRow>("select * from turns where id = ?", info.turnId);
  if (turn?.settled) return;
  run("update turns set returned = ? where id = ?", JSON.stringify(info.files.map((file) => file.path)), info.turnId);
  // What the turn returned that the drama doesn't have yet: an unchanged file returned again belongs to the turn that first returned it.
  const fresh = info.files.filter((file) => !file.sha256 || !seenBefore(session.drama_id, file.path, file.sha256));
  const stop = stopsForMaker(session, { ...info, files: fresh });
  const asked = info.question || info.summary;
  // A stop that neither returns nor names anything to review asks in words, whatever its folder holds:
  // the pictures found there go beside the question, not into a verdict on each.
  const pointed = [...info.files.map((file) => file.path), ...namedPaths(asked)].some((relPath) => VERDICT_KINDS.includes(classify(relPath).kind));
  if (stop) questionAsked(session, info.turnId, asked);
  if (!turn?.files_saved) {
    const computer = computerRow(session.computer_id)!;
    const where = { dramaId: session.drama_id, episodeId: session.episode_id, sessionId, turnId: info.turnId };
    // Packs keep their names and change at every stop: each stop's parts are all saved again.
    const packs = info.files.filter((file) => !fresh.includes(file) && classify(file.path).kind === "archive");
    try {
      for (const file of [...fresh, ...packs]) {
        const body = await fleet().openFile(computerRef(computer), sessionRef(session), file.path);
        await save(body, { ...where, relPath: file.path, type: file.type });
      }
      // Named but not returned: fetched, unless the drama has that file already.
      const fetch = async (relPath: string) => {
        const body = await fleet()
          .openFile(computerRef(computer), sessionRef(session), relPath)
          .catch((error: { status?: number }) => {
            if (error.status === 404) return undefined; // named, but not there
            throw error;
          });
        if (body) await save(body, { ...where, relPath, type: typeOf(relPath) });
      };
      const named = stop
        ? namedPaths(asked).filter((relPath) => !info.files.some((file) => file.path === relPath) && (!known(session.drama_id, relPath) || classify(relPath).kind === "archive"))
        : [];
      for (const relPath of named) await fetch(relPath);
      // The screenplay as drama-cli recorded it, the rewrite the maker is asked to accept included, whatever the turn named.
      if (!session.episode_id && (stop || info.state === "completed")) for (const relPath of await screenplayVersions(session)) await fetch(relPath);
      // A stop, or a finished turn, that brought nothing to look at: what the agent made is in its folder.
      if ((stop || info.state === "completed") && !get(`select id from files where turn_id = ? and kind in (${REVIEWED}) limit 1`, info.turnId)) {
        for (const relPath of await made(session)) await fetch(relPath);
      }
      run("update turns set files_saved = 1, save_error = null where id = ?", info.turnId);
    } catch (error) {
      // Kept for retry; the question stays "saving" until its files are in.
      run("update turns set save_error = ? where id = ?", (error as Error).message, info.turnId);
      publish(`drama:${session.drama_id}`);
      return;
    }
  }
  transaction(() => {
    if (stop) questionReady(session, info.turnId, !pointed);
    run("update turns set settled = 1 where id = ?", info.turnId);
  });
  await onEnded(sessionRow(sessionId)!, info, stop);
  publish(`drama:${session.drama_id}`, "dramas", `session:${sessionId}`);
  if (stop) await approveUnreviewed(session.drama_id);
}

/** Ended turns of open sessions that the flow hasn't acted on yet; following them again finishes the job. */
export function unsettledTurns(): TurnRow[] {
  return all<TurnRow>(
    "select t.* from turns t join sessions s on s.id = t.session_id where t.settled = 0 and t.ended_at is not null and s.state = 'open'",
  );
}

export function followEvents(sessionId: string): void {
  if (eventsFollowed.has(sessionId)) return;
  const controller = new AbortController();
  eventsFollowed.set(sessionId, controller);
  void eventsLoop(sessionId, controller.signal).finally(() => eventsFollowed.delete(sessionId));
}

export function stopEvents(sessionId: string): void {
  eventsFollowed.get(sessionId)?.abort();
}

async function eventsLoop(sessionId: string, signal: AbortSignal): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    const session = sessionRow(sessionId);
    const computer = session && computerRow(session.computer_id);
    if (!session || session.state !== "open" || computer?.state !== "running") return;
    try {
      for await (const event of fleet().events(computerRef(computer), sessionRef(session), session.cursor ?? undefined, session.task_id ?? undefined, signal)) {
        failures = 0;
        if (event.kind === "usage") {
          raiseCost(event.turnId, event.cost ?? null, event.media ?? null);
        } else if (event.kind === "activity") {
          run(
            `insert into messages (session_id, turn_id, kind, text, ref, at) values (?, ?, 'activity', ?, ?, ?)
             on conflict(session_id, ref) do update set text = excluded.text`,
            sessionId,
            event.turnId,
            event.text,
            event.ref ?? null,
            now(),
          );
        } else {
          run("insert into messages (session_id, turn_id, kind, text, at) values (?, ?, ?, ?, ?)", sessionId, event.turnId, event.kind, event.text, now());
        }
        if (event.kind === "progress") run("update sessions set activity = ? where id = ?", event.text, sessionId);
        run("update sessions set cursor = ?, task_id = ? where id = ?", event.id, event.taskId, sessionId);
        publish(`session:${sessionId}`, `drama:${session.drama_id}`);
      }
      if (signal.aborted) return;
      await sleep(2_000);
    } catch (error) {
      if (signal.aborted) return;
      failures += 1;
      await sleep(Math.min(30_000, 2_000 * failures));
    }
  }
}
