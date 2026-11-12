// A named Computer, as the server SDK sees it: rebuilt from its saved record on every call, so any
// process (the agent an app started, the viewer, the CLI) reaches the same one. A Computer keeps its
// identity: sign-ins, passkeys and skills stay with it across jobs and restarts. Each chat thread gets
// its own session on it, a separate workspace, still signed in.

import { Binding, Client, Credentials, NotFoundError, SandboxRetainedError, type Computer, type Session } from "@pinesandbox/computer";
import { log } from "./home.js";
import { scope, store, type Key } from "./store.js";

/** How long a Computer stays up with nothing to do. Waiting on a question isn't work. */
export const IDLE_SECONDS = Number(process.env.PINE_IDLE_TIMEOUT_SECONDS ?? 1800);

export interface ComputerRecord {
  name: string;
  id: string;
  credentials: string;
  /** Empty while no sandbox holds the Computer. */
  binding: string;
  bindingRevision: string;
  createdAt: string;
}

export interface SessionRecord {
  name: string;
  token: string;
  bindingRevision: string;
  usedAt?: string;
  /** The process running a job in it. */
  busy?: { pid: number; since: string };
}

let shared: Client | undefined;
export function client(): Client {
  const project = scope();
  if (project) return project.client;
  if (!process.env.PINE_SANDBOX_API_KEY) throw new Error("Set PINE_SANDBOX_API_KEY (and PINE_SANDBOX_ENDPOINT) in the app's environment or in ~/.pine-computer/env.");
  return (shared ??= Client.fromEnv());
}

const computerKey = (name: string): Key => ["computers", name];
const sessionKey = (computer: string, session: string): Key => ["sessions", computer, session];

export const readComputer = (name: string) => store().get<ComputerRecord>(computerKey(name));

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(saved.credentials), Binding.parse(saved.binding));
}

/** The Computer as last bound, without checking that it still runs. Null when it has no sandbox. */
export async function bound(name: string): Promise<Computer | null> {
  return handle(await readComputer(name));
}

/** Creates, starts or resumes the Computer as needed. One process at a time per Computer. */
export function ensureComputer(name: string, onStep?: (text: string) => void): Promise<Computer> {
  return store().lock(`computer-${name}`, async () => {
    const saved = await readComputer(name);
    if (!saved) {
      onStep?.("Creating the computer");
      const credentials = await Credentials.generate();
      // Saved before Create: they're the only way to start this Computer again.
      const record: ComputerRecord = { name, id: credentials.id, credentials: credentials.serialize(), binding: "", bindingRevision: "0", createdAt: new Date().toISOString() };
      await store().set(computerKey(name), record);
      const created = await client().createComputer({ credentials, idleTimeoutSeconds: IDLE_SECONDS });
      return save(record, created);
    }
    let found = handle(saved);
    if (found) {
      try {
        const state = (await found.status()).toLowerCase();
        if (state === "paused") {
          onStep?.("Waking the computer");
          await found.resume();
        } else if (!["running", "resuming", "starting"].includes(state)) found = null;
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        found = null;
      }
    }
    if (found) return found;
    onStep?.("Starting the computer");
    const credentials = Credentials.parse(saved.credentials);
    try {
      found = await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS });
    } catch (error) {
      if (!(error instanceof SandboxRetainedError)) throw error;
      // Still held by a sandbox nobody tracks any more: give it up and start from the saved state.
      found = await client().recoverComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS });
    }
    return save(saved, found);
  });
}

async function save(record: ComputerRecord, found: Computer): Promise<Computer> {
  if (!record.binding || BigInt(record.bindingRevision) < found.bindingRevision) {
    await store().set(computerKey(record.name), { ...record, binding: found.binding().serialize(), bindingRevision: found.bindingRevision.toString() });
  }
  return found;
}

/** A session that's open under the Computer's current binding, or null. */
export async function existingSession(computerName: string, sessionName: string): Promise<Session | null> {
  const found = await bound(computerName);
  const saved = await store().get<SessionRecord>(sessionKey(computerName, sessionName));
  if (!found || !saved || saved.bindingRevision !== found.bindingRevision.toString()) return null;
  return found.adoptSession(saved.name, saved.token);
}

/**
 * Opens the session, or adopts it when it's already open on this binding. A Computer that restarted has
 * a new binding and no sessions: the session opens again, empty, and `fresh` says so.
 */
export async function openSession(found: Computer, computerName: string, sessionName: string, label: string): Promise<{ session: Session; fresh: boolean }> {
  const key = sessionKey(computerName, sessionName);
  return store().lock(`session-${computerName}-${sessionName}`, async () => {
    const saved = await store().get<SessionRecord>(key);
    if (saved && saved.bindingRevision === found.bindingRevision.toString()) return { session: found.adoptSession(saved.name, saved.token), fresh: false };
    let opened: Session;
    try {
      opened = await create(found, computerName, sessionName, label);
    } catch (error) {
      // Open already, but its token was lost: open it again to get one.
      if ((error as { status?: number }).status !== 409 || limit(error)) throw error;
      await found.destroySession(sessionName);
      opened = await create(found, computerName, sessionName, label);
    }
    await store().set(key, { name: opened.name, token: opened.token, bindingRevision: found.bindingRevision.toString(), usedAt: new Date().toISOString() } satisfies SessionRecord);
    return { session: opened, fresh: true };
  });
}

const limit = (error: unknown) => /session-limit/.test(String((error as Error).message));

/**
 * A Computer holds a few sessions at a time. When they're all taken, the thread used longest ago gives
 * its session up: its sign-ins stay with the Computer, and its history comes back as a recap if it's
 * used again. A thread with a job running keeps its session.
 */
async function create(found: Computer, computerName: string, sessionName: string, label: string): Promise<Session> {
  for (;;) {
    try {
      return await found.createSession({ name: sessionName, label });
    } catch (error) {
      if (!limit(error)) throw error;
      const open = await found.sessions();
      const candidates: { name: string; usedAt: string }[] = [];
      for (const s of open) {
        if (s.name === sessionName) continue;
        const record = await store().get<SessionRecord>(sessionKey(computerName, s.name));
        if (record?.busy && alive(record.busy.pid)) continue;
        candidates.push({ name: s.name, usedAt: record?.usedAt ?? "" });
      }
      const oldest = candidates.sort((a, b) => a.usedAt.localeCompare(b.usedAt))[0];
      if (!oldest) throw new Error(`All ${open.length} sessions on this computer are busy. Try again when a job finishes, or give this app its own computer (PINE_COMPUTER).`);
      log(`closing session ${oldest.name} to make room`);
      await found.destroySession(oldest.name, { clean: true }).catch((e) => {
        if ((e as { status?: number }).status !== 404) throw e;
      });
      await store().delete(sessionKey(computerName, oldest.name));
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Marks a thread's session as in use by this process, or done; used to pick a session to close. */
export async function markSession(computerName: string, sessionName: string, busy: boolean): Promise<void> {
  const key = sessionKey(computerName, sessionName);
  const saved = await store().get<SessionRecord>(key);
  if (!saved) return;
  await store().set(key, { ...saved, usedAt: new Date().toISOString(), busy: busy ? { pid: process.pid, since: new Date().toISOString() } : undefined });
}

export interface SessionView {
  name: string;
  usedAt?: string;
  working: boolean;
}

/** The sessions this install holds on a Computer: the ones working first, then the most recently used. */
export async function sessionsOf(computerName: string): Promise<SessionView[]> {
  const views: SessionView[] = [];
  for (const name of await store().list(["sessions", computerName])) {
    const saved = await store().get<SessionRecord>(sessionKey(computerName, name));
    if (saved) views.push({ name: saved.name, usedAt: saved.usedAt, working: !!saved.busy && alive(saved.busy.pid) });
  }
  return views.sort((a, b) => Number(b.working) - Number(a.working) || (b.usedAt ?? "").localeCompare(a.usedAt ?? ""));
}

/** Saves what the Computer keeps (sign-ins, passkeys, skills), then releases its sandbox. */
export async function stopComputer(name: string): Promise<boolean> {
  return store().lock(`computer-${name}`, async () => {
    const saved = await readComputer(name);
    const found = handle(saved);
    if (!saved || !found) return false;
    const stopped = await found.stop().catch((error) => {
      if (error instanceof NotFoundError) return true;
      throw error;
    });
    if (stopped) await store().set(computerKey(name), { ...saved, binding: "" });
    else log(`stop of ${name} is unconfirmed`);
    return stopped;
  });
}

export interface ComputerView {
  name: string;
  state: string;
  stopAt?: string;
}

export async function describe(name: string): Promise<ComputerView> {
  const found = await bound(name);
  if (!found) return { name, state: (await readComputer(name)) ? "stopped" : "none" };
  try {
    const details = await found.sandboxDetails();
    return { name, state: details.state.toLowerCase(), stopAt: (details.lifetime?.stopAt ?? details.expiresAt)?.toISOString() };
  } catch (error) {
    if (error instanceof NotFoundError) return { name, state: "stopped" };
    throw error;
  }
}
