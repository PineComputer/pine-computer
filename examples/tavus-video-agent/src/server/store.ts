// What the demo keeps, in one JSON file (.data/store.json): the Computer and its session, the claim case
// and the conversations about it. Secrets (the Computer's credentials and binding, the session token)
// are sealed with AES-256-GCM under DEMO_SECRET and never reach a browser.

import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DEMO_DATA_DIR ?? path.join(process.cwd(), ".data"));
const FILE = path.join(DATA_DIR, "store.json");

export type Sealed = string;

export interface ComputerRecord {
  id: string;
  credentials: Sealed;
  /** "" while the Computer has no sandbox. */
  binding: Sealed;
  bindingRevision: string;
}

export interface SessionRecord {
  name: string;
  token: Sealed;
  bindingRevision: string;
}

export interface CaseFile {
  path: string;
  name: string;
  size: number;
  contentType: string;
}

export type Who = "customer" | "pal" | "computer" | "operator" | "check";

export interface CaseEntry {
  at: string;
  who: Who;
  text: string;
}

/** One warranty claim, from the first ask to the claim number, across as many calls as it takes. */
export interface ClaimCase {
  id: string;
  startedAt: string;
  request: { product: string; issue: string; resolution: string; details: string };
  /** working | needs_input | done | failed | stopped */
  state: "working" | "needs_input" | "done" | "failed" | "stopped";
  turnId: string;
  question?: string;
  /** approval: the agent stopped before an irreversible step; info: it needs a fact only the customer has. */
  questionKind?: "approval" | "info";
  summary?: string;
  claimNumber?: string;
  /** The portal's own records show the claim number. */
  verified?: boolean;
  files: CaseFile[];
  log: CaseEntry[];
  /** The rated cost of the turns so far, in USD, where Pine priced them. */
  cost: number;
  endedAt?: string;
}

export interface ConversationRecord {
  id: string;
  url: string;
  startedAt: string;
}

export interface Data {
  computer?: ComputerRecord;
  session?: SessionRecord;
  claim?: ClaimCase;
  conversations: ConversationRecord[];
}

function key(): Buffer {
  const secret = process.env.DEMO_SECRET;
  if (!secret || secret.length < 16) throw new Error("Set DEMO_SECRET in .env.local (openssl rand -base64 32).");
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

async function load(): Promise<Data> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { conversations: [] };
    throw error;
  }
}

// One change at a time, each written whole, so a crash never leaves half a record. The queue lives on
// globalThis because Next.js can load this module more than once in one process.
const shared = globalThis as typeof globalThis & { __demoStore?: Promise<unknown> };
shared.__demoStore ??= Promise.resolve();

export function read(): Promise<Data> {
  return shared.__demoStore!.then(load);
}

export function update<T>(change: (data: Data) => T): Promise<T> {
  const next = shared.__demoStore!.then(async () => {
    const data = await load();
    const result = change(data);
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, FILE);
    return result;
  });
  shared.__demoStore = next.catch(() => undefined);
  return next;
}
