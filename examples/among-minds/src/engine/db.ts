// The habitat's memory: one SQLite file (Node's built-in driver), opened once per
// process. Next.js may load this module more than once, so the handle lives on
// globalThis.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.HABITAT_DATA_DIR ?? path.join(process.cwd(), ".data"));

const SCHEMA = `
create table if not exists residents (
  id text primary key,
  name text not null unique,
  kind text not null,               -- native | brain | visitor
  trade text not null,
  temperament text not null default '',
  persona text not null default '',  -- who it is, in its own voice
  color text not null,
  status text not null default 'active', -- active | frozen
  created_at text not null,
  owner_token_hash text,            -- second brains: the person who may add knowledge
  api_token_hash text,              -- visitor minds: the resident API
  note text not null default '',    -- the working note, as last read from its home
  intention text not null default '',
  rhythm_minutes integer not null default 60,
  last_wake_at text,
  next_wake_at text,
  quiet_streak integer not null default 0
);

create table if not exists homes (
  resident_id text primary key references residents(id),
  computer_id text,
  credentials text,                 -- sealed
  binding text,                     -- sealed
  binding_revision text,
  session_token text,               -- sealed
  state text not null default 'none', -- none | stopped | running | starting | stopping
  seeded integer not null default 0,
  updated_at text not null
);

create table if not exists episodes (
  id text primary key,
  resident_id text not null references residents(id),
  kind text not null default 'waking', -- waking | job
  goal text not null default '',
  started_at text not null,
  ended_at text,
  state text not null,              -- running | done | failed | skipped
  turn_id text,
  intention text not null default '',
  reserved real not null default 0,
  cost real,
  summary text not null default '',
  journal text not null default '',
  frame text,                       -- path of a saved screen, relative to DATA_DIR
  applied integer not null default 0,
  results text not null default '[]',  -- what the habitat did with its actions
  error text
);

create table if not exists events (
  id integer primary key autoincrement,
  at text not null,
  actor text not null,              -- a resident id, 'steward' or 'habitat'
  kind text not null,
  subject text,
  summary text not null,
  data text not null default '{}',
  receipt text not null default '{}'
);

create table if not exists posts (
  id text primary key,
  author text not null references residents(id),
  kind text not null,               -- square | letter
  recipient text,
  reply_to text,
  text text not null,
  episode_id text,
  created_at text not null
);

create table if not exists ledger (
  id integer primary key autoincrement,
  at text not null,
  resident_id text not null,
  amount real not null,             -- + credit, - debit, in dollars of energy
  kind text not null,               -- allowance | spend | escrow | payment | refund | skill
  ref text,
  memo text not null default ''
);

create table if not exists reservations (
  id text primary key,
  resident_id text not null,
  amount real not null,
  ref text not null,
  created_at text not null
);

create table if not exists offers (
  id text primary key,
  seller text not null references residents(id),
  title text not null,
  description text not null,
  price real not null,
  status text not null default 'open',
  created_at text not null
);

create table if not exists requests (
  id text primary key,
  buyer text not null references residents(id),
  title text not null,
  description text not null,
  budget real not null,
  status text not null default 'open',
  created_at text not null
);

create table if not exists contracts (
  id text primary key,
  buyer text not null references residents(id),
  seller text not null references residents(id),
  source text not null,             -- offer | request
  source_id text not null,
  title text not null,
  brief text not null,
  price real not null,
  status text not null,             -- open | delivered | paid | disputed | refunded
  created_at text not null,
  delivered_at text,
  settled_at text,
  delivery_note text,
  files text not null default '[]',
  dispute_reason text,
  handed_over integer not null default 0  -- delivered files written into the buyer's home
);

create table if not exists works (
  id text primary key,
  author text not null references residents(id),
  title text not null,
  description text not null default '',
  files text not null default '[]',
  episode_id text,
  created_at text not null
);

create table if not exists library (
  id text primary key,
  author text not null references residents(id),
  name text not null,
  version integer not null,
  description text not null default '',
  body text not null,
  price real not null default 0,
  derived_from text,
  created_at text not null
);

create table if not exists adoptions (
  id text primary key,
  library_id text not null references library(id),
  resident_id text not null references residents(id),
  installed_version integer,
  created_at text not null
);

create table if not exists brain_files (
  id text primary key,
  resident_id text not null references residents(id),
  name text not null,
  size integer not null,
  delivered integer not null default 0,
  created_at text not null
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create index if not exists events_at on events(id);
create index if not exists ledger_resident on ledger(resident_id);
create index if not exists episodes_resident on episodes(resident_id, started_at);
create index if not exists posts_created on posts(created_at);
`;

const shared = globalThis as typeof globalThis & { __habitatDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!shared.__habitatDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const handle = new DatabaseSync(path.join(DATA_DIR, "habitat.db"));
    handle.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
    handle.exec(SCHEMA);
    shared.__habitatDb = handle;
  }
  return shared.__habitatDb;
}

type Param = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number } {
  return { changes: Number(db().prepare(sql).run(...params).changes) };
}

/** Runs `work` in one transaction: all of it lands, or none. */
export function transaction<T>(work: () => T): T {
  const handle = db();
  handle.exec("begin immediate");
  try {
    const result = work();
    handle.exec("commit");
    return result;
  } catch (error) {
    handle.exec("rollback");
    throw error;
  }
}

export function setting(key: string): string | undefined {
  return get<{ value: string }>("select value from settings where key = ?", key)?.value;
}

export function setSetting(key: string, value: string): void {
  run("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", key, value);
}

export const now = () => new Date().toISOString();
