// What this app keeps, in one JSON file: .data/store.json, or under COWORKERS_DATA_DIR.
//
// One workspace: its coworkers (each with the records of its own Computer), their
// threads, the jobs done in them and a vault. A product keeps the same records in its
// database, one set per workspace. Everything secret (a Computer's credentials and
// binding, session tokens, vault values) is sealed with AES-256-GCM under
// COWORKERS_SECRET and never leaves the server.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Item } from "@/shared/fold";
import { publish } from "./live";
import { seed } from "./seed";

// Chosen at runtime: the build has nothing to trace here.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.COWORKERS_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

/** A secret, encrypted: base64 of iv (12 bytes), ciphertext and tag. */
export type Sealed = string;

/** A coworker's own Computer. Absent until its first job creates it. */
export interface ComputerRecord {
  id: string;
  /** Credentials.serialize(): start this Computer again and decrypt its saved state. */
  credentials: Sealed;
  /** Binding.serialize(): reach the sandbox it's running in. "" while it has none. */
  binding: Sealed;
  /** The binding's revision. A binding is saved only over an older one. */
  bindingRevision: string;
  /** When it stops itself if nothing uses it, as last read. */
  expiresAt?: string;
}

export interface SkillRecord {
  name: string;
  description: string;
}

export interface CoworkerRecord {
  id: string;
  name: string;
  role: string;
  /** How it works and what it is for: sent with every job as context. */
  brief: string;
  /** Its avatar's colour, one of the names in globals.css. */
  color: string;
  /** A first job to offer while it has no threads. */
  suggestion?: string;
  createdAt: string;
  computer?: ComputerRecord;
  /** Its learned skills as last listed, so the profile shows them while the Computer is stopped. */
  skills: SkillRecord[];
  /** The thread a person is driving on its Computer: one at a time. */
  driving?: string;
}

/** A thread is one session on its coworker's Computer. Its id is the session's name. */
export interface ThreadRecord {
  id: string;
  coworker: string;
  title: string;
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

/** A skill drafted from this job's run. */
export interface LearnRecord {
  /** drafting | draft | active | none */
  state: string;
  name?: string;
  version?: number;
  /** Why no draft came of it. */
  reason?: string;
  startedAt: string;
}

/** One message to a coworker and the work it led to, kept after its Computer stops. */
export interface JobRecord {
  /** The key the page made for the message; also the run's idempotency key. */
  id: string;
  thread: string;
  coworker: string;
  /** run: a job; answer: a reply to its question, which carries the same job on. */
  kind: "run" | "answer";
  /** What was asked, or the reply. */
  ask: string;
  askedAt: string;
  /** The Computer's turn, once it has admitted the job. */
  turnId?: string;
  /** queued | starting | running | canceling | needs_input | answered | completed | failed | canceled | stopped */
  state: string;
  /** Why it waits in the queue, in words for the thread. */
  waiting?: string;
  summary?: string;
  endedAt?: string;
  durationMs?: number;
  /** The job's rated cost in USD, when it was priced. */
  cost?: number | null;
  /** Its steps and notes, kept when it ends. */
  items?: Item[];
  /** The files it returned, copied into the data directory. Absent until recorded. */
  files?: TurnFile[];
  learn?: LearnRecord;
}

export interface SecretRecord {
  /** How messages refer to it: $NAME. */
  name: string;
  value: Sealed;
  note?: string;
  updatedAt: string;
}

export interface StoreData {
  version: 1;
  coworkers: CoworkerRecord[];
  threads: ThreadRecord[];
  jobs: JobRecord[];
  secrets: SecretRecord[];
}

function key(): Buffer {
  const secret = process.env.COWORKERS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Set COWORKERS_SECRET in .env.local (openssl rand -base64 32).");
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

async function load(): Promise<StoreData> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as StoreData;
  } catch (error) {
    // A new workspace starts with its first three coworkers.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, coworkers: seed(), threads: [], jobs: [], secrets: [] };
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

/** Changes the records, and tells the open pages. */
export function update<T>(change: (data: StoreData) => T): Promise<T> {
  const next = shared.__storeQueue!.then(async () => {
    const data = await load();
    const result = change(data);
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, FILE);
    publish({ type: "changed" });
    return result;
  });
  shared.__storeQueue = next.catch(() => undefined);
  return next;
}
