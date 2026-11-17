// What this app keeps, in one JSON file: .data/store.json, or under TESTER_DATA_DIR.
//
// One workspace: the records of its one Computer, and every run with its findings. The
// pictures of the screen are files beside it (.data/screens/). A product keeps the same
// records in its database, one set per workspace. Everything secret (the Computer's
// credentials and binding, session tokens) is sealed with AES-256-GCM under
// TESTER_SECRET and never leaves the server.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, Moment, Screen } from "@/shared/api";
import { publish } from "./live";

// Chosen at runtime: the build has nothing to trace here.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.TESTER_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

/** A secret, encrypted: base64 of iv (12 bytes), ciphertext and tag. */
export type Sealed = string;

/** The workspace's Computer. Absent until the first run creates it. */
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

/** One run: a target, what to check, and what came of it. Its id is its session's name. */
export interface RunRecord {
  /** The key the page made for the run; also the session's name and the run's idempotency key. */
  id: string;
  target: string;
  checks: string;
  askedAt: string;
  /** queued | starting | running | canceling | needs_input | completed | failed | canceled | stopped */
  state: string;
  waiting?: string;
  /** The session token from createSession, while the session is open. */
  token?: Sealed;
  /** The binding revision the session was opened under. Every Start ends every session. */
  bindingRevision?: string;
  /** The Computer's turn the run is on: an answer opens the next one. */
  turnId?: string;
  /** The agent's Task and how far into its events this app has read. */
  taskId?: string;
  cursor: number;
  doing?: string;
  question?: string;
  summary?: string;
  endedAt?: string;
  findings: Finding[];
  screens: Screen[];
  moments: Moment[];
  /** A person has the controls, until this time unless they act. */
  driving?: { idleDeadline?: string };
}

export interface StoreData {
  version: 1;
  computer?: ComputerRecord;
  runs: RunRecord[];
}

function key(): Buffer {
  const secret = process.env.TESTER_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Set TESTER_SECRET in .env.local (openssl rand -base64 32).");
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, runs: [] };
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

/** Where a saved picture of the screen is kept; `name` is its event's id and its type. */
export function storedScreen(run: string, name: string): string {
  if (!/^\d+\.(webp|png|jpeg)$/.test(name)) throw new Error("That isn't one of the run's screens.");
  return path.join(DATA_DIR, "screens", path.basename(run), name);
}
