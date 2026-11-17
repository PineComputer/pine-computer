// What this app keeps, in one JSON file: .data/store.json, or under WATCH_DATA_DIR.
//
// The history lives here, not on the Computer: every check's reading, its time, and
// (beside this file, under screens/) the picture of the screen it left. Two checks are
// compared from these records, so nothing depends on what a stopped Computer remembers.
// A product keeps the same records in its own database, one set per user. Everything
// secret (the Computer's credentials and binding, the session token) is sealed with
// AES-256-GCM under WATCH_SECRET and never leaves the server.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Cadence, Difference, Field } from "@/shared/api";
import { publish } from "./live";

// Chosen at runtime: the build has nothing to trace here.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.WATCH_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

/** A secret, encrypted: base64 of iv (12 bytes), ciphertext and tag. */
export type Sealed = string;

export interface ComputerRecord {
  id: string;
  /** Credentials.serialize(): start this Computer again. */
  credentials: Sealed;
  /** Binding.serialize(): reach the sandbox it's running in. "" while it has none. */
  binding: Sealed;
  /** The binding's revision. A binding is saved only over an older one. */
  bindingRevision: string;
  /** The session token from createSession, for this binding. Every Start ends every session. */
  session?: Sealed;
  /** stopped | starting | running | stopping, as this app last left it. */
  state: "stopped" | "starting" | "running" | "stopping";
  /** A person has the controls. */
  driving?: boolean;
}

export interface WatchRecord {
  id: string;
  /** What to watch, in the person's words. */
  what: string;
  url: string;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  /** When the worker checks next. */
  nextAt: string;
  /** A Computer that wouldn't start (a limit, say): try this slot again from here. */
  retryAt?: string;
  /** Why the last attempt didn't start. */
  waiting?: string;
}

export interface CheckRecord {
  id: string;
  watchId: string;
  /** first: made when the watch was created; schedule: the worker, at its time; hand: Check now. */
  trigger: "first" | "schedule" | "hand";
  /** The time a scheduled check was due. */
  dueAt?: string;
  /** The idempotency key its run was sent with: sending it again returns the same turn. */
  runKey: string;
  startedAt: string;
  endedAt?: string;
  /** starting | running | asking | done | failed */
  state: "starting" | "running" | "asking" | "done" | "failed";
  /** The agent's turn doing it: the run's, then each answer's. */
  turnId?: string;
  step?: string;
  /** Its browser has opened: the Computer's screen has something to see. */
  onScreen?: boolean;
  question?: string;
  problem?: string;
  fields?: Field[];
  /** Where on the screen it read them: "top left", "centre"… */
  place?: string;
  outcome?: "first" | "same" | "changed";
  comparedWith?: string;
  change?: { sentence: string; differences: Difference[] };
  /** The picture's file under screens/, once kept. */
  screen?: string;
}

export interface UserData {
  computer?: ComputerRecord;
  watches: WatchRecord[];
  checks: CheckRecord[];
}

export interface StoreData {
  version: 1;
  users: Record<string, UserData>;
}

function key(): Buffer {
  const secret = process.env.WATCH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Set WATCH_SECRET in .env.local (openssl rand -base64 32).");
  }
  return createHash("sha256").update(secret).digest();
}

export function seal(plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

export function open(sealed: Sealed): string {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
}

export const emptyUser = (): UserData => ({ watches: [], checks: [] });

async function load(): Promise<StoreData> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as StoreData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, users: {} };
    throw error;
  }
}

// One change at a time, each written whole (to a temporary file, then renamed), so a
// crash never leaves half a record. Next.js can load this module more than once (the
// worker and the routes are bundled apart), so the queue lives on globalThis: one per
// process, whichever copy writes.
const shared = globalThis as typeof globalThis & { __storeQueue?: Promise<unknown> };
shared.__storeQueue ??= Promise.resolve();

export function read(): Promise<StoreData> {
  return shared.__storeQueue!.then(load);
}

export async function readUser(user: string): Promise<UserData> {
  return (await read()).users[user] ?? emptyUser();
}

export function update<T>(change: (data: StoreData) => T): Promise<T> {
  const next = shared.__storeQueue!.then(async () => {
    const data = await load();
    const result = change(data);
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, FILE);
    return result;
  });
  shared.__storeQueue = next.catch(() => undefined);
  return next;
}

/** Changes one user's records, and tells their open pages. */
export async function updateUser<T>(user: string, change: (data: UserData) => T): Promise<T> {
  const result = await update((data) => change((data.users[user] ??= emptyUser())));
  publish(user, { type: "changed" });
  return result;
}
