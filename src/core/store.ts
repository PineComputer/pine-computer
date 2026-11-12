// What outlives a process, behind one interface: each Computer's credentials and binding, each thread's
// session and history. The CLI keeps them as files in ~/.pine-computer; a hosted service, which runs as
// several processes for many projects, keeps them in a database (PINE_DATABASE_URL).
//
// A hosted request runs in a scope: the project it came from and that project's client. Everything a scope
// stores sits under its project, so one project can't read another's Computer or threads.

import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import type { Client } from "@pinesandbox/computer";
import { at, readJson, safe, withLock, writeJson } from "./home.js";

/** A record's place: ["sessions", computer, session]. */
export type Key = string[];

export interface Store {
  get<T>(key: Key): Promise<T | undefined>;
  set(key: Key, value: unknown): Promise<void>;
  delete(key: Key): Promise<void>;
  /** The last part of every key directly under a prefix. */
  list(prefix: Key): Promise<string[]>;
  /** Runs fn with no other holder of the same name running, in this process or another. */
  lock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export interface Scope {
  /** A stable name for the project, safe to store. Never the key itself. */
  project: string;
  client: Client;
}

const scopes = new AsyncLocalStorage<Scope>();

export const scope = () => scopes.getStore();
export const inScope = <T>(s: Scope, fn: () => T): T => scopes.run(s, fn);

/** The project a key belongs to, as a name that doesn't give the key away. */
export const projectOf = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 32);

/** A name unique to the current project, for what a process keeps in memory per thread. */
export const scoped = (name: string) => {
  const s = scope();
  return s ? `${s.project}:${name}` : name;
};

/** A folder on this disk for the current project: the files a job takes and returns. */
export const own = (...parts: string[]) => {
  const s = scope();
  return at(...(s ? ["projects", s.project] : []), ...parts);
};

/** Files under ~/.pine-computer, one JSON file per record. */
const files: Store = {
  get: (key) => readJson(file(key)),
  set: (key, value) => writeJson(file(key), value),
  delete: (key) => rm(file(key), { force: true }),
  list: async (prefix) => {
    const names = await readdir(at(...prefix.map(safe))).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  },
  lock: (name, fn) => withLock(name, fn),
};

const file = (key: Key) => `${at(...key.map(safe))}.json`;

/** PINE_STORE_KEY: what a hosted service seals its records and signs its links with. */
function storeKey(): Buffer {
  const secret = Buffer.from(process.env.PINE_STORE_KEY ?? "", "base64");
  if (secret.length !== 32) throw new Error("A hosted service needs PINE_STORE_KEY: 32 random bytes in base64, which seals what is stored and signs its links.");
  return secret;
}

/** A signature over a few names, for a link that grants exactly those and nothing beside them. */
export const signature = (...names: string[]) => createHmac("sha256", storeKey()).update(JSON.stringify(names)).digest("base64url").slice(0, 27);

/**
 * One table in Postgres. Records hold session tokens, which can run a shell on a Computer, so every value
 * is sealed with PINE_STORE_KEY (32 bytes, base64) before it's written.
 */
async function database(url: string): Promise<Store> {
  const secret = storeKey();
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("create table if not exists pine_computer_store (key text primary key, value text not null, updated_at timestamptz not null default now())");

  const seal = (value: unknown) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  };
  const open = <T>(sealed: string): T => {
    const raw = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  };
  const name = (key: Key) => key.map(encodeURIComponent).join("/");

  return {
    get: async <T>(key: Key) => {
      const { rows } = await pool.query("select value from pine_computer_store where key = $1", [name(key)]);
      return rows[0] ? open<T>(rows[0].value) : undefined;
    },
    set: async (key, value) => {
      await pool.query("insert into pine_computer_store (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [name(key), seal(value)]);
    },
    delete: async (key) => {
      await pool.query("delete from pine_computer_store where key = $1", [name(key)]);
    },
    list: async (prefix) => {
      const under = `${name(prefix)}/`;
      const { rows } = await pool.query("select key from pine_computer_store where starts_with(key, $1) and position('/' in substr(key, $2)) = 0", [under, under.length + 1]);
      return rows.map((r) => decodeURIComponent((r.key as string).slice(under.length)));
    },
    // A lock held by a connection: a process that dies lets go of it.
    lock: async (lockName, fn) => {
      const held = await pool.connect();
      try {
        await held.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockName]);
        try {
          return await fn();
        } finally {
          await held.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockName]);
        }
      } finally {
        held.release();
      }
    },
  };
}

let opened: Promise<Store> | undefined;
const backing = () => (opened ??= process.env.PINE_DATABASE_URL ? database(process.env.PINE_DATABASE_URL) : Promise.resolve(files));

const under = (prefix: Key): Store => ({
  get: async (key) => (await backing()).get([...prefix, ...key]),
  set: async (key, value) => (await backing()).set([...prefix, ...key], value),
  delete: async (key) => (await backing()).delete([...prefix, ...key]),
  list: async (key) => (await backing()).list([...prefix, ...key]),
  lock: async (name, fn) => (await backing()).lock([...prefix, name].join("/"), fn),
});

/** Opens the store, so a service that can't reach it fails as it starts and not on its first request. */
export const ready = async () => void (await backing());

/** What this process keeps for itself, whatever the project: the keys its own addresses carry. */
export const local = under([]);

/** The current project's records, or the CLI's own when there is no project. */
export function store(): Store {
  const s = scope();
  return s ? under(["projects", s.project]) : local;
}
