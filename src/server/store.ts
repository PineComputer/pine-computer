// What this app keeps, in one JSON file: .data/store.json, or under STARTER_DATA_DIR.
//
// A product keeps the same records in its own database, one set per user. Everything
// secret (the Computer's credentials and binding, session tokens, vault values) is
// sealed with AES-256-GCM under STARTER_SECRET and never leaves the server.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Cadence } from "@/shared/api";
import { publish } from "./live";
import { LOCAL_USER } from "./user";

// Chosen at runtime: the build has nothing to trace here.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.STARTER_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

/** A secret, encrypted: base64 of iv (12 bytes), ciphertext and tag. */
export type Sealed = string;

export interface ComputerRecord {
  id: string;
  /** Credentials.serialize(): start this Computer again and decrypt its saved state. */
  credentials: Sealed;
  /** Binding.serialize(): reach the sandbox it's running in. "" while it has none. */
  binding: Sealed;
  /** The binding's revision. A binding is saved only over an older one. */
  bindingRevision: string;
  /** Where its browser reaches the internet from, for the next Start: a country code or "direct". */
  location?: string;
  /** How long it may sit idle before it stops itself, for the next Start. */
  idleTimeoutSeconds?: number;
  /** Pause was refused: the project doesn't have Pause/Resume. */
  pauseUnavailable?: boolean;
}

export interface SessionRecord {
  /** The Computer's name for it: letters, digits, _ and -. */
  name: string;
  /** What people call it. */
  label: string;
  createdAt: string;
  /** The session token from createSession, while the session is open. */
  token?: Sealed;
  /** The binding revision it was opened under. Every Start ends every session. */
  bindingRevision?: string;
}

export interface TurnFile {
  path: string;
  size: number;
  contentType: string;
}

/** One turn of the agent's work, as this app remembers it after the Computer stops. */
export interface TurnRecord {
  turnId: string;
  session: string;
  /** The idempotency key the run was sent with: sending it again returns this turn. */
  runKey: string;
  /** run: a task; answer: an answer to its question, which opened this turn; schedule: a scheduled run. */
  kind: "run" | "answer" | "schedule";
  /** What was asked, or the answer. */
  ask: string;
  askedAt: string;
  /** running | canceling | needs_input | answered | completed | failed | canceled | stopped */
  state: string;
  scheduleId?: string;
  /** Files attached for it, under attachments/. */
  attachments?: string[];
  summary?: string;
  endedAt?: string;
  durationMs?: number;
  /** The turn's rated cost in USD, when it was priced. */
  cost?: number | null;
  /** The files it returned, copied into the data directory. Absent until recorded. */
  files?: TurnFile[];
}

export interface SecretRecord {
  /** How tasks refer to it: $NAME. */
  name: string;
  value: Sealed;
  note?: string;
  updatedAt: string;
}

export interface ScheduleRecord {
  id: string;
  label: string;
  session: string;
  goal: string;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  /** When it runs next. */
  nextAt: string;
  /** A busy session or a Computer that wouldn't start: try again from here. */
  retryAt?: string;
  lastAt?: string;
  lastTurnId?: string;
  lastError?: string;
}

export interface UserData {
  computer?: ComputerRecord;
  sessions: SessionRecord[];
  turns: TurnRecord[];
  secrets: SecretRecord[];
  schedules: ScheduleRecord[];
}

export interface StoreData {
  version: 2;
  users: Record<string, UserData>;
}

function key(): Buffer {
  const secret = process.env.STARTER_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Set STARTER_SECRET in .env.local (openssl rand -base64 32).");
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

export const emptyUser = (): UserData => ({ sessions: [], turns: [], secrets: [], schedules: [] });

/** A file from the first version of this app held one person's Computer and one session. */
export function upgrade(raw: Record<string, unknown>): StoreData {
  if (raw.version === 2) return raw as unknown as StoreData;
  const old = raw as { computer?: ComputerRecord; session?: { name: string; token: Sealed; bindingRevision: string }; turns?: TurnRecord[] };
  const user = emptyUser();
  user.computer = old.computer;
  const name = old.session?.name ?? "main";
  if (old.computer) user.sessions.push({ name, label: "Main", createdAt: new Date().toISOString(), ...(old.session ? { token: old.session.token, bindingRevision: old.session.bindingRevision } : {}) });
  user.turns = (old.turns ?? []).map((turn) => ({ ...turn, session: name }));
  return { version: 2, users: { [LOCAL_USER]: user } };
}

async function load(): Promise<StoreData> {
  try {
    return upgrade(JSON.parse(await readFile(FILE, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, users: {} };
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
