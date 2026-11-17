// The workspace's one Computer, as the server SDK sees it: created on the first run,
// rebuilt from its saved records on every request after that, and started again from
// its saved state once it has stopped. Each run gets a session of its own on it (a
// clean browser and a fresh agent), closed when the run ends.

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

/** How long the Computer may sit idle before it stops itself. */
const IDLE_SECONDS = Number(process.env.TESTER_IDLE_SECONDS) || 300;

/** A run can't start yet and should wait its turn; `message` says why, for the page. */
export class Waiting extends Error {}

interface Shared {
  __pine?: Client;
  /** One Create or Start at a time, shared by every run that needs it. */
  __starting?: Promise<Computer> | null;
  __stopping?: boolean;
}
const shared = globalThis as typeof globalThis & Shared;

/** Reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. */
export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

/** The Computer, ready to call, or null before it exists or while it is stopped. */
export async function computer(): Promise<Computer | null> {
  return handle((await read()).computer);
}

/** What the page shows for the Computer. */
export function computerState(data: Pick<StoreData, "computer">): "none" | "stopped" | "starting" | "running" | "stopping" {
  if (shared.__stopping) return "stopping";
  if (shared.__starting) return "starting";
  return !data.computer ? "none" : data.computer.binding ? "running" : "stopped";
}

/**
 * The Computer, running: created the first time, reused while it runs, and started
 * from its saved state after a stop. Throws Waiting when the project is running as many
 * Computers as it may.
 */
export function ensureComputer(): Promise<Computer> {
  if (shared.__starting) return shared.__starting;
  const next = bringUp().finally(() => {
    shared.__starting = null;
    publish({ type: "changed" }); // it is no longer starting
  });
  shared.__starting = next;
  return next;
}

async function bringUp(): Promise<Computer> {
  let saved = (await read()).computer;
  const running = handle(saved);
  if (running) {
    if ((await check()) === "running") return running;
    saved = (await read()).computer;
  }
  publish({ type: "changed" }); // the pages read "starting"
  try {
    if (!saved) {
      const credentials = await Credentials.generate();
      // Saved before Create: they are the only way to start this Computer again, even
      // if Create fails after registering it.
      await update((data) => {
        data.computer = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0" };
      });
      return await attached(await client().createComputer({ credentials, idleTimeoutSeconds: IDLE_SECONDS }));
    }
    const credentials = Credentials.parse(open(saved.credentials));
    try {
      return await attached(await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    } catch (error) {
      // Still running somewhere this app lost track of (a binding never saved): stop
      // that one, then start from what it saved.
      if (!(error instanceof SandboxRetainedError)) throw error;
      await client().stopComputer(saved.id);
      return await attached(await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    }
  } catch (error) {
    if (error instanceof CapacityExceededError) throw new Waiting("This project is running as many Computers as it may. The run starts when one stops.");
    if (error instanceof CreateRateLimitedError) throw new Waiting("Too many Computers started this minute. The run starts shortly.");
    throw error;
  }
}

// A binding is saved only over an older one, so a slow reply from one Start can never
// overwrite the binding of a later one.
async function attached(found: Computer): Promise<Computer> {
  const revision = found.bindingRevision;
  await update((data) => {
    const saved = data.computer;
    if (!saved || saved.id !== found.id) throw new Error("The saved Computer changed while it started.");
    if (saved.binding && BigInt(saved.bindingRevision) >= revision) return;
    saved.binding = seal(found.binding().serialize());
    saved.bindingRevision = revision.toString();
  });
  return found;
}

/** Looks at the running Computer: notes when it will idle out, or that it already has. */
export async function check(): Promise<"running" | "stopped"> {
  const found = await computer();
  if (!found) return "stopped";
  try {
    const details = await found.sandboxDetails();
    const state = details.state.toLowerCase();
    if (state === "stopped" || state === "failed" || state === "terminated") {
      await released();
      return "stopped";
    }
    const expiresAt = details.expiresAt?.toISOString();
    if (expiresAt !== (await read()).computer?.expiresAt) {
      await update((data) => {
        if (data.computer?.binding) data.computer.expiresAt = expiresAt;
      });
    }
    return "running";
  } catch (error) {
    // The sandbox record is gone: it stopped (idle, or from elsewhere).
    if (!(error instanceof NotFoundError)) throw error;
    await released();
    return "stopped";
  }
}

/** Saves what the Computer can keep, then releases its sandbox and sessions. */
export async function stop(): Promise<void> {
  const found = await computer();
  if (!found) return;
  shared.__stopping = true;
  publish({ type: "changed" });
  try {
    // A stop that isn't confirmed is not a stop: keep the binding and say so.
    if (!(await found.stop())) throw new HttpError(502, "The Computer didn't confirm it stopped. Try again.");
    await released();
  } finally {
    shared.__stopping = false;
    publish({ type: "changed" });
  }
}

/** The work a sandbox takes with it: a question can't be answered once it's gone. */
const ENDED_WITH_SANDBOX = new Set(["running", "canceling", "needs_input"]);

/** The sandbox is gone: its sessions closed, and a run still going, or still asking, ended with it. */
export async function released(): Promise<void> {
  await update((data) => {
    if (data.computer) {
      data.computer.binding = "";
      delete data.computer.expiresAt;
    }
    for (const run of data.runs) {
      delete run.token;
      delete run.bindingRevision;
      delete run.driving;
      if (!ENDED_WITH_SANDBOX.has(run.state)) continue;
      run.state = "stopped";
      run.summary = "The Computer stopped before this run finished. What it had recorded is kept.";
      run.endedAt ??= new Date().toISOString();
    }
  });
}

// ---- runs: one session each ---------------------------------------------------------

function sessionFrom(data: StoreData, run: string): Session | null {
  const saved = data.runs.find((r) => r.id === run);
  const found = handle(data.computer);
  if (!found || !saved?.token || saved.bindingRevision !== found.bindingRevision.toString()) return null;
  return found.adoptSession(saved.id, open(saved.token));
}

/** A run's open session, ready to drive, or null. */
export async function session(run: string): Promise<Session | null> {
  return sessionFrom(await read(), run);
}

export async function requireSession(run: string): Promise<Session> {
  const found = await session(run);
  if (!found) throw new HttpError(409, "This run's session has ended.");
  return found;
}

/** Opens the run's session on the running Computer: a clean browser and an agent that remembers nothing. */
export async function openSession(found: Computer, run: string, label: string): Promise<Session> {
  const adopted = await session(run);
  if (adopted) return adopted;
  let opened: Session;
  try {
    opened = await found.createSession({ name: run, label, browser: true });
  } catch (error) {
    // Opened before but its token was never saved: open it again to get one.
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    await found.destroySession(run);
    opened = await found.createSession({ name: run, label, browser: true });
  }
  // The Computer returns a session's token only here: keep it.
  await update((data) => {
    const record = data.runs.find((r) => r.id === run);
    if (record) Object.assign(record, { token: seal(opened.token), bindingRevision: found.bindingRevision.toString() });
  });
  return opened;
}

/** Closes a run's session once its findings and screens are saved here, so the next run has the room. */
export async function closeSession(run: string): Promise<void> {
  const found = await computer();
  await found?.destroySession(run, { clean: true }).catch((error) => console.error("closing a session:", error));
  await update((data) => {
    const record = data.runs.find((r) => r.id === run);
    if (!record) return;
    delete record.token;
    delete record.bindingRevision;
    delete record.driving;
  });
}
