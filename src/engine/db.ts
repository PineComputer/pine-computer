// The studio's records: one SQLite file (Node's built-in driver), opened once per process.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DATA_DIR } from "./config.ts";

const SCHEMA = `
create table if not exists dramas (
  id text primary key,
  title text not null,
  language text not null,           -- zh | en
  look text not null,
  format text not null,             -- e.g. 9:16 480p
  parallel integer not null,        -- episodes at work at once
  per_computer integer not null,    -- episodes per Computer at once (1-3)
  notes text not null default '',
  length text not null default '',  -- each episode's length, about this many seconds (60, 90, 120); '' from before it was asked
  mode text not null,               -- pine | replay: where its work runs, fixed at creation
  rehearsal integer not null default 0, -- 1: Pine's agent stands in for the drama skill (goals.ts, rehearsed)
  reviewing text not null default 'every', -- every | key | none: what the maker reviews (reviews.ts, LEFT)
  preset text not null default '',  -- the drama-cli preset the maker chose; '' until chosen
  screenplay_language text not null default '', -- en | zh: drama-cli init --screenplay-language; '' until chosen
  screenplay_file integer,          -- the input file that is the screenplay; null until chosen
  status text not null,             -- setup | production | done | stopped
  note text not null default '',    -- why it stopped
  continues integer not null default 0,
  created_at text not null,
  updated_at text not null
);

-- The maker's own files for a drama: the screenplay and notes.
create table if not exists inputs (
  drama_id text not null,
  file_id integer not null,
  primary key (drama_id, file_id)
);

create table if not exists episodes (
  id text primary key,
  drama_id text not null,
  number integer not null,
  title text not null default '',
  state text not null,              -- queued | working | waiting | done | stopped | failed
  session_id text,
  note text not null default '',    -- why it stopped or failed
  resume integer not null default 0,
  carry text not null default '',   -- the maker's last decision, for the session that resumes it
  continues integer not null default 0,
  updated_at text not null,
  unique (drama_id, number)
);

-- The studio's own settings: the Pine project it uses (its key sealed), or replay.
create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists computers (
  id text primary key,              -- Pine's Computer id
  drama_id text not null,
  mode text not null default 'pine', -- pine | replay: which fleet made it
  project text not null default '', -- which project it was made in (Fleet.project); '' from before this was kept
  label text not null,              -- PC-1, PC-2, ...
  credentials text not null,        -- sealed
  binding text,                     -- sealed; null while stopped
  revision text,
  state text not null,              -- starting | running | stopping | stopped | failed
  idle_timeout integer,
  stop_by text,                     -- when Pine will stop it, its running time per start up; null where there's no limit
  last_error text,
  failures integer not null default 0, -- starts that failed in a row
  created_at text not null,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  computer_id text not null,
  drama_id text not null,
  name text not null,
  token text,                       -- sealed
  role text not null,               -- setup | episode
  episode_id text,
  state text not null,              -- open | closed | lost
  task_id text,
  cursor text,                      -- last applied event id, for task_id
  activity text,
  created_at text not null,
  closed_at text
);

-- Every run sent to an agent, keyed by the idempotency key saved before sending.
create table if not exists runs (
  key text primary key,
  session_id text not null,
  kind text not null,               -- setup | episode | resume | continue | chat
  goal text not null,
  turn_id text,
  created_at text not null
);

create table if not exists turns (
  id text primary key,              -- Pine's turn id
  session_id text not null,
  state text not null,
  question text not null default '',
  summary text not null default '',
  files_saved integer not null default 0,
  returned text not null default '[]', -- the paths the turn returned, saved before or not (JSON)
  settled integer not null default 0, -- the flow has acted on how it ended
  save_error text,
  cost real,
  media real,                       -- the additional charges in cost: generated video
  next_turn_id text,
  created_at text not null,
  ended_at text
);

create table if not exists reviews (
  id text primary key,
  drama_id text not null,
  episode_id text,
  session_id text not null,
  turn_id text not null unique,
  kind text not null,
  state text not null,              -- saving | open | sending | answered | ended
  question text not null,
  decision text,                    -- JSON Decision
  answer text,
  created_at text not null,
  decided_at text
);

-- The library's index. Bytes live under library/, named by SHA-256.
create table if not exists files (
  id integer primary key,
  drama_id text not null,
  episode_id text,
  session_id text,
  turn_id text,
  sha text not null,
  rel_path text not null,
  name text not null,
  type text not null,
  size integer not null,
  kind text not null,
  subject text,
  look text,
  segment text,
  style text,
  version text,
  created_at text not null,
  unique (turn_id, rel_path)
);

create table if not exists messages (
  id integer primary key,
  session_id text not null,
  turn_id text,
  kind text not null,
  text text not null,
  ref text,                         -- activity id, to update a step in place
  at text not null,
  unique (session_id, ref)
);

create index if not exists files_episode on files (episode_id, id);
create index if not exists files_drama_kind on files (drama_id, kind, id);
create index if not exists files_turn on files (turn_id);
create index if not exists reviews_episode on reviews (episode_id, created_at);
`;

const shared = globalThis as typeof globalThis & { __studioDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!shared.__studioDb) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const handle = new DatabaseSync(path.join(DATA_DIR, "studio.db"));
    handle.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    handle.exec(SCHEMA);
    // Columns added after a data folder was first made.
    const add = (table: string, column: string, definition: string, backfill?: string) => {
      const columns = (handle.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((row) => row.name);
      if (columns.includes(column)) return;
      handle.exec(`alter table ${table} add column ${column} ${definition}`);
      if (backfill) handle.exec(backfill);
    };
    add("computers", "mode", "text not null default 'replay'");
    add("computers", "failures", "integer not null default 0");
    add("dramas", "mode", "text not null default 'replay'");
    add("turns", "settled", "integer not null default 0", "update turns set settled = files_saved");
    add("episodes", "carry", "text not null default ''");
    add("dramas", "reason", "text not null default ''");
    add("computers", "stop_by", "text");
    add("computers", "project", "text not null default ''");
    add("dramas", "rehearsal", "integer not null default 0");
    add("turns", "media", "real");
    add("dramas", "length", "text not null default ''");
    add("turns", "returned", "text not null default '[]'");
    add("dramas", "reviewing", "text not null default 'every'");
    add("dramas", "preset", "text not null default ''");
    add("dramas", "screenplay_language", "text not null default ''");
    add("dramas", "screenplay_file", "integer");
    shared.__studioDb = handle;
  }
  return shared.__studioDb;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
  const result = db().prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

let depth = 0;

/** Runs related writes all or none; one inside another joins it. */
export function transaction<T>(work: () => T): T {
  if (depth > 0) return work();
  const handle = db();
  handle.exec("begin");
  depth += 1;
  try {
    const result = work();
    handle.exec("commit");
    return result;
  } catch (error) {
    handle.exec("rollback");
    throw error;
  } finally {
    depth -= 1;
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
