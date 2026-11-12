// The library: every file a turn returns, and the maker's own inputs, kept by the studio
// so review, screening and delivery outlive the Computer. Bytes are stored once, named by
// SHA-256; the index row says what the file is and where it came from.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileItem, FileKind } from "../shared/types.ts";
import { classify, namedPaths } from "./classify.ts";
import { DATA_DIR } from "./config.ts";
import { all, get, now, run } from "./db.ts";

const ROOT = path.join(DATA_DIR, "library");

export interface FileRow {
  id: number;
  drama_id: string;
  episode_id: string | null;
  session_id: string | null;
  turn_id: string | null;
  sha: string;
  rel_path: string;
  name: string;
  type: string;
  size: number;
  kind: FileKind;
  subject: string | null;
  look: string | null;
  segment: string | null;
  style: string | null;
  version: string | null;
  created_at: string;
}

/** A file's address for the UI. Row ids can be reused, so the URL names the content too and can be cached for good. */
export function fileUrl(row: Pick<FileRow, "id" | "sha">): string {
  return `/api/files/${row.id}?v=${row.sha.slice(0, 16)}`;
}

export function blobPath(sha: string): string {
  return path.join(ROOT, sha.slice(0, 2), sha);
}

/** Writes a stream to the library and returns its SHA-256 and size. */
async function store(body: ReadableStream<Uint8Array> | Uint8Array): Promise<{ sha: string; size: number }> {
  mkdirSync(ROOT, { recursive: true });
  const temp = path.join(ROOT, `.incoming-${crypto.randomUUID()}`);
  const hash = createHash("sha256");
  let size = 0;
  const source = body instanceof Uint8Array ? Readable.from([body]) : Readable.fromWeb(body as never);
  source.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });
  try {
    await pipeline(source, createWriteStream(temp));
    const sha = hash.digest("hex");
    const target = blobPath(sha);
    if (existsSync(target)) rmSync(temp);
    else {
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(temp, target);
    }
    return { sha, size };
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export interface Origin {
  dramaId: string;
  episodeId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  relPath: string;
  type: string;
  /** Overrides the kind read from the path, for the maker's own inputs. */
  kind?: FileKind;
}

/** Whether the drama already has this file, at the same path with the same bytes: the agent returned it before. */
export function seenBefore(dramaId: string, relPath: string, sha: string): boolean {
  return get("select id from files where drama_id = ? and rel_path = ? and sha = ? limit 1", dramaId, relPath, sha) !== undefined;
}

/**
 * Saves one file and indexes it. A file already saved for the same turn and path is not
 * saved again, so following a turn twice is safe; nor is one the agent returns again
 * unchanged, which stays with the turn that first returned it (its review, its verdict).
 */
export async function save(body: ReadableStream<Uint8Array> | Uint8Array, origin: Origin): Promise<number> {
  if (origin.turnId) {
    const existing = get<{ id: number }>("select id from files where turn_id = ? and rel_path = ?", origin.turnId, origin.relPath);
    if (existing) return existing.id;
  }
  const { sha, size } = await store(body);
  const hints = classify(origin.relPath);
  const kind = origin.kind ?? hints.kind;
  // A pack's parts are saved with every turn that returns them: the newest turn's set is whole on its own.
  if (origin.turnId && kind !== "archive") {
    const earlier = get<{ id: number }>("select id from files where drama_id = ? and rel_path = ? and sha = ? order by id limit 1", origin.dramaId, origin.relPath, sha);
    if (earlier) return earlier.id;
  }
  const result = run(
    `insert into files (drama_id, episode_id, session_id, turn_id, sha, rel_path, name, type, size, kind, subject, look, segment, style, version, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    origin.dramaId,
    origin.episodeId ?? null,
    origin.sessionId ?? null,
    origin.turnId ?? null,
    sha,
    origin.relPath,
    path.posix.basename(origin.relPath),
    origin.type || "application/octet-stream",
    size,
    kind,
    hints.subject ?? null,
    hints.look ?? null,
    hints.segment ?? null,
    hints.style ?? null,
    hints.version ?? null,
    now(),
  );
  return result.lastInsertRowid;
}

export function fileRow(id: number): FileRow | undefined {
  return get<FileRow>("select * from files where id = ?", id);
}

export function openBlob(row: FileRow, range?: { start: number; end: number }) {
  return createReadStream(blobPath(row.sha), range);
}

export function toItem(row: FileRow): FileItem {
  return item(row, undefined);
}

/** File items for an episode whose label the caller already knows, without a lookup per file. */
export function itemIn(episode: string): (row: FileRow) => FileItem {
  return (row) => item(row, episode);
}

function item(row: FileRow, episode: string | undefined): FileItem {
  return {
    id: row.id,
    name: row.name,
    path: row.rel_path,
    type: row.type,
    size: row.size,
    kind: row.kind,
    // Pre-production writes episodes' files before the episodes exist: their path names them.
    episode: episode ?? (row.episode_id ? episodeLabel(row.episode_id) : undefined) ?? classify(row.rel_path).episode,
    segment: row.segment ?? undefined,
    subject: row.subject ?? undefined,
    look: row.look ?? undefined,
    style: row.style ?? undefined,
    version: row.version ?? undefined,
    url: fileUrl(row),
    createdAt: row.created_at,
  };
}

function episodeLabel(episodeId: string): string | undefined {
  const row = get<{ number: number }>("select number from episodes where id = ?", episodeId);
  return row ? `EP${String(row.number).padStart(3, "0")}` : undefined;
}

/** The kinds of file the maker gives a verdict on. */
export const VERDICT_KINDS: FileKind[] = ["look", "location", "prop", "storyboard", "blocking", "take", "cut"];

export function filesOfTurn(turnId: string): FileRow[] {
  return all<FileRow>("select * from files where turn_id = ? order by id", turnId);
}

/**
 * What a stop puts before the maker: what its turn brought in and, when that is nothing to give a
 * verdict on, what it returned again or its question names that the drama already has, the newest
 * at each path (storyboards a resumed session asks about again, unchanged, belong to the turn that
 * first returned them). Unchanged files beside new work keep the verdict they had.
 */
export function filesOfStop(stop: { turn_id: string; drama_id: string; question: string }): FileRow[] {
  const own = filesOfTurn(stop.turn_id);
  if (own.some((file) => VERDICT_KINDS.includes(file.kind))) return own;
  const returned = JSON.parse(get<{ returned: string }>("select returned from turns where id = ?", stop.turn_id)?.returned ?? "[]") as string[];
  const earlier = [...new Set([...returned, ...namedPaths(stop.question)])]
    .filter((relPath) => !own.some((file) => file.rel_path === relPath))
    .flatMap((relPath) => get<FileRow>("select * from files where drama_id = ? and rel_path = ? order by id desc limit 1", stop.drama_id, relPath) ?? []);
  return [...own, ...earlier];
}

/** Natural order for versions and takes: v2 before v10. */
export function versionNumber(version: string | null | undefined): number {
  return Number(version?.replace(/\D/g, "") || 0);
}
