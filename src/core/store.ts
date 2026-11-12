// What outlives a process: each Computer's credentials and binding, each thread's session and history.
// The CLI keeps them as files in ~/.pine-computer. They sit behind one interface so that a service for many
// projects (src/hosted) can keep them somewhere several processes share.
//
// Such a service runs each request in a scope: the project it came from, and that project's client.
// Everything a scope stores sits under its project, so one project can't read another's Computer or threads.

import { AsyncLocalStorage } from "node:async_hooks";
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

let backing: Store = files;

/** Keeps the records somewhere else from here on. Called once, before anything is read. */
export function useStore(other: Store): void {
  backing = other;
}

const under = (prefix: Key): Store => ({
  get: (key) => backing.get([...prefix, ...key]),
  set: (key, value) => backing.set([...prefix, ...key], value),
  delete: (key) => backing.delete([...prefix, ...key]),
  list: (key) => backing.list([...prefix, ...key]),
  lock: (name, fn) => backing.lock([...prefix, name].join("/"), fn),
});

/** What this process keeps for itself, whatever the project: the keys its own addresses carry. */
export const local = under([]);

/** The current project's records, or the CLI's own when there is no project. */
export function store(): Store {
  const s = scope();
  return s ? under(["projects", s.project]) : local;
}
