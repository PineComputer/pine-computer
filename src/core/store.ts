// What outlives a process: each Computer's credentials and binding, each thread's session and history.
// They are files in ~/.pine-computer, one JSON file per record, reached by a key.

import { readdir, rm } from "node:fs/promises";
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

const file = (key: Key) => `${at(...key.map(safe))}.json`;

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

export const store = (): Store => files;
