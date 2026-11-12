// Starting work in a session: hand it the files it needs, then send the goal with an
// idempotency key saved first, so a lost response is resent with the same key and never
// starts a second run.
import path from "node:path";
import { readFileSync } from "node:fs";
import { MAX_ATTACHMENT, REHEARSAL_KIT } from "./config.ts";
import { all, get, newId, now, run, transaction } from "./db.ts";
import { computerRef, fleet, sessionRef } from "./computers.ts";
import { followEvents, followTurn, recordTurn } from "./follow.ts";
import { STANDIN_KIT } from "./goals.ts";
import { blobPath, type FileRow } from "./library.ts";
import { publish } from "./live.ts";
import { type SessionRow, computer as computerRow, session as sessionRow } from "./records.ts";

/** A flat, unique attachment name for a library file: Pine takes a single file name. */
export function attachmentName(row: FileRow): string {
  // The parts of a packed project keep their names, so `cat project.tar.part-*` puts them back in order.
  if (row.kind === "archive") return path.posix.basename(row.rel_path);
  const ext = path.posix.extname(row.name) || "";
  const parts: (string | null | undefined)[] = (() => {
    switch (row.kind) {
      case "bible":
        return ["bible", row.version];
      case "look":
        return ["look", row.subject, row.look, row.version];
      case "location":
        return ["location", row.subject, row.look, row.version];
      case "prop":
        return ["prop", row.subject, row.version];
      case "storyboard":
        return ["storyboard", row.segment, row.style, row.version];
      case "blocking":
        return ["blocking", row.segment, row.version];
      case "frame":
        return ["first-frame", row.segment, row.version];
      case "take":
        return ["take", row.segment, row.version];
      case "cut":
        return ["cut", row.version];
      case "breakdown":
        return ["breakdown", row.version];
      case "screenplay":
        return [path.posix.basename(row.name, ext)];
      case "brief":
        return ["brief"];
      case "subtitles":
        return ["subtitles", row.version];
      case "reference":
        return ["reference", String(row.id), path.posix.basename(row.name, ext)];
      default:
        return [`file${row.id}`, path.posix.basename(row.name, ext)];
    }
  })();
  const base = parts
    .filter(Boolean)
    .join("-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_");
  return `${base}${ext}`;
}

/**
 * The parts of the newest packed project a turn returned: the drama's (no episode) or one episode's.
 * Only a turn whose files were all saved counts: parts saved before its Computer went away are no pack.
 */
function newestArchive(where: string, ...params: string[]): FileRow[] {
  const newest = get<FileRow>(
    `select * from files where kind = 'archive' and ${where}
     and turn_id in (select id from turns where files_saved = 1) order by id desc limit 1`,
    ...params,
  );
  return newest ? all<FileRow>(`select * from files where kind = 'archive' and turn_id = ? and ${where} order by rel_path`, newest.turn_id!, ...params) : [];
}

/** The drama-cli project pre-production handed over: bible, every breakdown and shared reference, accepted. */
export function projectArchive(dramaId: string): FileRow[] {
  return newestArchive("drama_id = ? and episode_id is null", dramaId);
}

/** An episode's own folder as its last session packed it, to carry on from. */
export function episodeArchive(episodeId: string): FileRow[] {
  return newestArchive("episode_id = ?", episodeId);
}

/** The drama's approved references: the newest bible, look, location and prop the setup returned. */
export function references(dramaId: string): FileRow[] {
  const rows = all<FileRow>(
    `select f.* from files f join sessions s on s.id = f.session_id
     where f.drama_id = ? and s.role = 'setup' and f.kind in ('bible', 'look', 'location', 'prop')
     order by f.id desc`,
    dramaId,
  );
  const newest = new Map<string, FileRow>();
  for (const row of rows) {
    const key = [row.kind, row.subject, row.look, path.posix.extname(row.name)].join("|");
    if (!newest.has(key)) newest.set(key, row);
  }
  return [...newest.values()].reverse();
}

export function inputs(dramaId: string): FileRow[] {
  return all<FileRow>("select f.* from files f join inputs i on i.file_id = f.id where i.drama_id = ? order by f.id", dramaId);
}

/** Writes files into the session's attachments; returns the names it used (also by file id) and the ones too large to send. */
export async function attach(session: SessionRow, files: FileRow[]): Promise<{ sent: string[]; names: Record<number, string>; skipped: string[] }> {
  const computer = computerRow(session.computer_id)!;
  const sent: string[] = [];
  const names: Record<number, string> = {};
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const file of files) {
    let name = attachmentName(file);
    while (used.has(name)) name = `${file.id}-${name}`;
    used.add(name);
    if (file.size > MAX_ATTACHMENT) {
      skipped.push(name);
      continue;
    }
    await fleet().writeFile(computerRef(computer), sessionRef(session), name, readFileSync(blobPath(file.sha)));
    sent.push(name);
    names[file.id] = name;
  }
  return { sent, names, skipped };
}

/** A rehearsal's kit, handed to each of its sessions with the drama's files. */
export async function attachKit(session: SessionRow): Promise<void> {
  const computer = computerRow(session.computer_id)!;
  await fleet().writeFile(computerRef(computer), sessionRef(session), STANDIN_KIT, readFileSync(REHEARSAL_KIT));
}

/** Saves a run to send, with the idempotency key it will always be sent with; returns the key. */
export function saveRun(sessionId: string, kind: string, goal: string): string {
  const key = newId("run");
  run("insert into runs (key, session_id, kind, goal, created_at) values (?, ?, ?, ?, ?)", key, sessionId, kind, goal, now());
  return key;
}

/** Sends a goal to a session's agent and starts following the turn it opens. */
export async function startRun(session: SessionRow, kind: string, goal: string): Promise<void> {
  await sendRun(saveRun(session.id, kind, goal));
}

/** Sends a saved run, or resends it with the same key when its first response was lost. */
export async function sendRun(key: string): Promise<void> {
  const saved = get<{ key: string; session_id: string; goal: string; turn_id: string | null }>("select * from runs where key = ?", key);
  if (!saved || saved.turn_id) return;
  const session = sessionRow(saved.session_id);
  const computer = session && computerRow(session.computer_id);
  if (!session || session.state !== "open" || computer?.state !== "running") return;
  const info = await fleet().run(computerRef(computer), sessionRef(session), saved.goal, key);
  transaction(() => {
    run("update runs set turn_id = ? where key = ?", info.turnId, key);
    recordTurn(session.id, info);
  });
  followTurn(session.id, info.turnId);
  followEvents(session.id);
  publish(`drama:${session.drama_id}`, `session:${session.id}`);
}

/** Whether the session has been given a run (sent or waiting to be resent): its start finished. */
export function hasRun(sessionId: string): boolean {
  return get<{ key: string }>("select key from runs where session_id = ? limit 1", sessionId) !== undefined;
}

/** Runs whose response never arrived, to resend with their saved keys. */
export function unconfirmedRuns(): string[] {
  return all<{ key: string }>(
    "select r.key from runs r join sessions s on s.id = r.session_id where r.turn_id is null and s.state = 'open'",
  ).map((row) => row.key);
}
