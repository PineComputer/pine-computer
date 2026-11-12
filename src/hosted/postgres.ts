// The records in Postgres, for a service that runs as more than one process. One table. The records hold
// session tokens, which can run a shell on a Computer, so every value is sealed before it is written.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Key, Store } from "../core/store.js";

export async function postgres(url: string, secret: Buffer): Promise<Store> {
  // `pg` is an optional peer: the CLI never needs it.
  const pg = await import("pg").then(
    (m) => m.default,
    () => {
      throw new Error("PINE_DATABASE_URL needs the `pg` package: run `npm install pg` beside pine-computer.");
    },
  );
  // Locks get connections of their own. A lock holds one for as long as its work runs, and that work reads
  // and writes through the other pool: on one pool, enough waiting locks would leave the holder none.
  const pool = new pg.Pool({ connectionString: url });
  const locks = new pg.Pool({ connectionString: url });
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
    // Held by a connection: a process that dies lets go of it.
    lock: async (lockName, fn) => {
      const held = await locks.connect();
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
