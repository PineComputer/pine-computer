// Each coworker's own Computer, as the server SDK sees it: created on the coworker's
// first job, rebuilt from its saved records on every request after that, and started
// again from its saved state once it has stopped. A thread is one session on it.

import "server-only";
import {
  ApiError,
  Binding,
  CapacityExceededError,
  Client,
  CreateRateLimitedError,
  Credentials,
  NotFoundError,
  SandboxRetainedError,
  type Computer,
  type Session,
} from "@pinesandbox/computer";
import { HttpError } from "./http";
import { publish } from "./live";
import { open, read, seal, update, type ComputerRecord, type StoreData } from "./store";

/** How long a Computer may sit idle before it stops itself: three coworkers don't mean three Computers running all day. */
const IDLE_SECONDS = Number(process.env.COWORKERS_IDLE_SECONDS) || 600;

/** A job can't start yet and should wait its turn; `message` says why, for the thread. */
export class Waiting extends Error {}

interface Shared {
  __pine?: Client;
  /** One Create or Start per coworker at a time, shared by every job that needs it. */
  __starting?: Map<string, Promise<Computer>>;
  __stopping?: Set<string>;
  __sessionLimit?: Map<string, number>;
}
const shared = globalThis as typeof globalThis & Shared;
const starting = (shared.__starting ??= new Map());
const stopping = (shared.__stopping ??= new Set());
const sessionLimit = (shared.__sessionLimit ??= new Map());

/** Reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. */
export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

const coworkerIn = (data: StoreData, id: string) => {
  const found = data.coworkers.find((c) => c.id === id);
  if (!found) throw new HttpError(404, "That coworker isn't in this workspace.");
  return found;
};

/** A coworker's Computer, ready to call, or null before it exists or while it is stopped. */
export async function computer(coworker: string): Promise<Computer | null> {
  return handle(coworkerIn(await read(), coworker).computer);
}

export async function requireComputer(coworker: string): Promise<Computer> {
  const found = await computer(coworker);
  if (!found) throw new HttpError(409, "Its Computer is stopped. Start it, or send it a job.");
  return found;
}

/** What the page shows for a coworker's Computer. */
export function computerState(coworker: { id: string; computer?: ComputerRecord }): "none" | "stopped" | "starting" | "running" | "stopping" {
  if (stopping.has(coworker.id)) return "stopping";
  if (starting.has(coworker.id)) return "starting";
  return !coworker.computer ? "none" : coworker.computer.binding ? "running" : "stopped";
}

/**
 * The coworker's Computer, running: created the first time, reused while it runs, and
 * started from its saved state (sign-ins, skills) after a stop. Throws Waiting when the
 * project is running as many Computers as it may.
 */
export function ensureComputer(coworker: string): Promise<Computer> {
  const underway = starting.get(coworker);
  if (underway) return underway;
  const next = bringUp(coworker).finally(() => {
    starting.delete(coworker);
    publish({ type: "changed" }); // it is no longer starting
  });
  starting.set(coworker, next);
  return next;
}

async function bringUp(coworker: string): Promise<Computer> {
  let saved = coworkerIn(await read(), coworker).computer;
  const running = handle(saved);
  if (running) {
    if ((await check(coworker)) === "running") return running;
    saved = coworkerIn(await read(), coworker).computer;
  }
  publish({ type: "changed" }); // the pages read "starting"
  try {
    if (!saved) {
      const credentials = await Credentials.generate();
      // Saved before Create: they are the only way to start this Computer again, even
      // if Create fails after registering it.
      await update((data) => {
        coworkerIn(data, coworker).computer = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0" };
      });
      return await attached(coworker, await client().createComputer({ credentials, idleTimeoutSeconds: IDLE_SECONDS }));
    }
    const credentials = Credentials.parse(open(saved.credentials));
    try {
      return await attached(coworker, await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    } catch (error) {
      // Still running somewhere this app lost track of (a binding never saved): stop
      // that one, then start from what it saved.
      if (!(error instanceof SandboxRetainedError)) throw error;
      await client().stopComputer(saved.id);
      return await attached(coworker, await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    }
  } catch (error) {
    if (error instanceof CapacityExceededError) throw new Waiting("This project is running as many Computers as it may. The job starts when one stops.");
    if (error instanceof CreateRateLimitedError) throw new Waiting("Too many Computers started this minute. The job starts shortly.");
    throw error;
  }
}

// A binding is saved only over an older one, so a slow reply from one Start can never
// overwrite the binding of a later one.
async function attached(coworker: string, found: Computer): Promise<Computer> {
  const revision = found.bindingRevision;
  await update((data) => {
    const saved = coworkerIn(data, coworker).computer;
    if (!saved || saved.id !== found.id) throw new Error("The saved Computer changed while it started.");
    if (saved.binding && BigInt(saved.bindingRevision) >= revision) return;
    saved.binding = seal(found.binding().serialize());
    saved.bindingRevision = revision.toString();
  });
  return found;
}

/** Looks at a running Computer: notes when it will idle out, or that it already has. */
export async function check(coworker: string): Promise<"running" | "stopped"> {
  const found = await computer(coworker);
  if (!found) return "stopped";
  try {
    const details = await found.sandboxDetails();
    const state = details.state.toLowerCase();
    if (state === "stopped" || state === "failed" || state === "terminated") {
      await released(coworker);
      return "stopped";
    }
    const expiresAt = details.expiresAt?.toISOString();
    if (expiresAt !== coworkerIn(await read(), coworker).computer?.expiresAt) {
      await update((data) => {
        const saved = coworkerIn(data, coworker).computer;
        if (saved?.binding) saved.expiresAt = expiresAt;
      });
    }
    return "running";
  } catch (error) {
    // The sandbox record is gone: it stopped (idle, or from elsewhere).
    if (!(error instanceof NotFoundError)) throw error;
    await released(coworker);
    return "stopped";
  }
}

/** Saves what the Computer can keep, then releases its sandbox and sessions. */
export async function stop(coworker: string): Promise<void> {
  const found = await computer(coworker);
  if (!found) return;
  stopping.add(coworker);
  publish({ type: "changed" });
  try {
    // A stop that isn't confirmed is not a stop: keep the binding and say so.
    if (!(await found.stop())) throw new HttpError(502, "The Computer didn't confirm it stopped. Try again.");
    await released(coworker);
  } finally {
    stopping.delete(coworker);
    publish({ type: "changed" });
  }
}

/** The work a sandbox takes with it: a question can't be answered once it's gone. */
const ENDED_WITH_SANDBOX = new Set(["running", "canceling", "needs_input"]);

/** The sandbox is gone: its sessions closed, and a job still running, or still asking, ended with it. */
export async function released(coworker: string): Promise<void> {
  await update((data) => {
    const found = coworkerIn(data, coworker);
    if (found.computer) {
      found.computer.binding = "";
      delete found.computer.expiresAt;
    }
    delete found.driving;
    for (const thread of data.threads) {
      if (thread.coworker !== coworker) continue;
      delete thread.token;
      delete thread.bindingRevision;
    }
    for (const job of data.jobs) {
      if (job.coworker === coworker && ENDED_WITH_SANDBOX.has(job.state)) {
        job.state = "stopped";
        job.endedAt ??= new Date().toISOString();
      }
    }
  });
}

/** Lets a coworker go: its Computer is deleted for good, with its sign-ins, skills and threads. */
export async function dismiss(coworker: string): Promise<string[]> {
  const saved = coworkerIn(await read(), coworker).computer;
  if (saved) await client().deleteComputer(saved.id);
  return update((data) => {
    const jobs = data.jobs.filter((j) => j.coworker === coworker).map((j) => j.id);
    data.coworkers = data.coworkers.filter((c) => c.id !== coworker);
    data.threads = data.threads.filter((t) => t.coworker !== coworker);
    data.jobs = data.jobs.filter((j) => j.coworker !== coworker);
    return jobs;
  });
}

// ---- threads: one session each ----------------------------------------------------

function sessionFrom(data: StoreData, thread: string): Session | null {
  const saved = data.threads.find((t) => t.id === thread);
  const found = saved && handle(data.coworkers.find((c) => c.id === saved.coworker)?.computer);
  if (!found || !saved?.token || saved.bindingRevision !== found.bindingRevision.toString()) return null;
  return found.adoptSession(saved.id, open(saved.token));
}

/** A thread's open session, ready to drive, or null. */
export async function session(thread: string): Promise<Session | null> {
  return sessionFrom(await read(), thread);
}

export async function requireSession(thread: string): Promise<Session> {
  const found = await session(thread);
  if (!found) throw new HttpError(409, "This thread's session has ended. Send a message to open it again.");
  return found;
}

/** The Computer a thread's session is on. */
export async function computerOf(thread: string): Promise<{ coworker: string; computer: Computer }> {
  const saved = (await read()).threads.find((t) => t.id === thread);
  if (!saved) throw new HttpError(404, "That thread isn't in this workspace.");
  return { coworker: saved.coworker, computer: await requireComputer(saved.coworker) };
}

const BUSY = new Set(["starting", "running", "canceling", "needs_input"]);

/**
 * The thread's session on a running Computer; `fresh` when it was just opened, with
 * nothing of the thread's earlier work in the agent's memory. A Computer runs a few
 * sessions at once: at the limit, the thread idle the longest gives up its session
 * (its history stays here), and if every one is busy the job waits.
 */
export async function ensureSession(found: Computer, thread: string): Promise<{ session: Session; fresh: boolean }> {
  const data = await read();
  const adopted = sessionFrom(data, thread);
  if (adopted) return { session: adopted, fresh: false };
  const saved = data.threads.find((t) => t.id === thread);
  if (!saved) throw new HttpError(404, "That thread isn't in this workspace.");

  const revision = found.bindingRevision.toString();
  const openThreads = data.threads.filter((t) => t.coworker === saved.coworker && t.token && t.bindingRevision === revision);
  if (openThreads.length >= (await limit(found))) {
    const lastUsed = (id: string) => data.jobs.findLast((j) => j.thread === id)?.askedAt ?? "";
    const idle = openThreads
      .filter((t) => t.id !== coworkerIn(data, saved.coworker).driving && !data.jobs.some((j) => j.thread === t.id && BUSY.has(j.state)))
      .sort((a, b) => lastUsed(a.id).localeCompare(lastUsed(b.id)))[0];
    if (!idle) throw new Waiting(`Its Computer is working in ${openThreads.length} threads already. The job starts when one finishes.`);
    await found.destroySession(idle.id, { clean: true });
    await update((next) => {
      const closed = next.threads.find((t) => t.id === idle.id);
      if (closed) delete closed.token;
    });
  }

  let opened: Session;
  try {
    opened = await found.createSession({ name: saved.id, label: saved.title, browser: true });
  } catch (error) {
    // Opened before but its token was never saved: open it again to get one.
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    await found.destroySession(saved.id);
    opened = await found.createSession({ name: saved.id, label: saved.title, browser: true });
  }
  // The Computer returns a session's token only here: keep it.
  await update((next) => {
    const record = next.threads.find((t) => t.id === thread);
    if (record) Object.assign(record, { token: seal(opened.token), bindingRevision: revision });
  });
  return { session: opened, fresh: true };
}

/** How many sessions this Computer runs at once, from the Computer; asked once per Start. */
async function limit(found: Computer): Promise<number> {
  const cacheKey = `${found.id}:${found.bindingRevision}`;
  const known = sessionLimit.get(cacheKey);
  if (known) return known;
  const raw = (await found.capabilities().catch(() => ({}))) as { limits?: { id: string; value: number }[] };
  const value = raw.limits?.find((l) => l.id === "sessions.concurrent")?.value ?? 3;
  sessionLimit.set(cacheKey, value);
  return value;
}
