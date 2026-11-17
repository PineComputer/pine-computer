// What this app keeps, in one JSON file: .data/store.json, or under CARREL_DATA_DIR.
//
// One desk: its three readers (each with the records of its own Computer), the briefs
// asked of it, and the runs done for them. A product keeps the same records in its
// database, one set per workspace. Everything secret (a Computer's credentials and
// binding, session tokens) is sealed with AES-256-GCM under CARREL_SECRET and never
// leaves the server.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Angle, BriefState, Report } from "@/shared/api";
import type { Item } from "@/shared/fold";
import type { Notes, Page } from "@/shared/notes";
import { publish } from "./live";

// Chosen at runtime: the build has nothing to trace here.
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.CARREL_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

/** A secret, encrypted: base64 of iv (12 bytes), ciphertext and tag. */
export type Sealed = string;

/** A reader's own Computer. Absent until its first run creates it. */
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

/** One of the desk's three readers. It works on one run at a time, in one session. */
export interface ReaderRecord {
  id: string;
  name: string;
  computer?: ComputerRecord;
  /** The session open on its Computer: named after the run it was opened for. */
  session?: { run: string; token: Sealed; bindingRevision: string };
  /** A person has the controls of that session. */
  driving?: boolean;
}

export interface BriefRecord {
  id: string;
  question: string;
  createdAt: string;
  state: BriefState;
  angles: Angle[];
  /** Why it stopped short, in words for the page. */
  problem?: string;
  report?: Report;
}

/** One job handed to a reader's Computer, and what came back, kept after the Computer stops. */
export interface RunRecord {
  /** Also the session's name and the run's idempotency key. */
  id: string;
  brief: string;
  kind: "plan" | "read" | "write";
  angle?: string;
  reader: string;
  goal: string;
  askedAt: string;
  /** The Computer's turn, once it has admitted the run. */
  turnId?: string;
  /** queued | starting | running | canceling | needs_input | completed | failed | canceled | stopped */
  state: string;
  waiting?: string;
  /** The answer, a question, or why the turn stopped. */
  summary?: string;
  endedAt?: string;
  /** Its steps, kept when it ends. Absent until then. */
  items?: Item[];
  /** The pages its browser opened, with the picture of each. */
  pages?: Page[];
  /** The JSON file it returned, as text. */
  returned?: string;
  notes?: Notes;
  dropped?: number;
}

export interface StoreData {
  version: 1;
  readers: ReaderRecord[];
  briefs: BriefRecord[];
  runs: RunRecord[];
}

function key(): Buffer {
  const secret = process.env.CARREL_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Set CARREL_SECRET in .env.local (openssl rand -base64 32).");
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

/** How many Computers read at once. Other apps may share the project's limit: keep it small. */
export const READERS = 3;

async function load(): Promise<StoreData> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as StoreData;
  } catch (error) {
    // A new desk has its readers, and no Computers yet.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, readers: Array.from({ length: READERS }, (_, i) => ({ id: `r${i + 1}`, name: `Reader ${i + 1}` })), briefs: [], runs: [] };
    }
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
