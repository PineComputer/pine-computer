// Each reader's own Computer, as the server SDK sees it: created on the reader's first
// run, rebuilt from its saved records on every request after that, and started again
// from its saved state once it has stopped. A run is one session on it.

import "server-only";
import {
  ApiError,
  Binding,
  CapacityExceededError,
  Client,
  ComputerAlreadyStartedError,
  CreateRateLimitedError,
  Credentials,
  NotFoundError,
  SandboxRetainedError,
  type Computer,
  type Session,
} from "@pinesandbox/computer";
import { HttpError } from "./http";
import { publish } from "./live";
import { open, read, seal, update, type ComputerRecord, type ReaderRecord, type StoreData } from "./store";

/** How long a Computer may sit idle before it stops itself: three readers don't mean three Computers running all day. */
const IDLE_SECONDS = Number(process.env.CARREL_IDLE_SECONDS) || 600;

/** A run can't start yet and should wait its turn; `message` says why, for the page. */
export class Waiting extends Error {}

interface Shared {
  __pine?: Client;
  /** One Create or Start per reader at a time, shared by every run that needs it. */
  __starting?: Map<string, Promise<Computer>>;
  __stopping?: Set<string>;
}
const shared = globalThis as typeof globalThis & Shared;
const starting = (shared.__starting ??= new Map());
const stopping = (shared.__stopping ??= new Set());

/** Reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. */
export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

const readerIn = (data: StoreData, id: string) => {
  const found = data.readers.find((r) => r.id === id);
  if (!found) throw new HttpError(404, "That reader isn't at this desk.");
  return found;
};

/** A reader's Computer, ready to call, or null before it exists or while it is stopped. */
export async function computer(reader: string): Promise<Computer | null> {
  return handle(readerIn(await read(), reader).computer);
}

/** What the page shows for a reader's Computer. */
export function computerState(reader: ReaderRecord): "none" | "stopped" | "starting" | "running" | "stopping" {
  if (stopping.has(reader.id)) return "stopping";
  if (starting.has(reader.id)) return "starting";
  return !reader.computer ? "none" : reader.computer.binding ? "running" : "stopped";
}

/**
 * The reader's Computer, running: created the first time, reused while it runs, and
 * started from its saved state after a stop. Throws Waiting when the project is running
 * as many Computers as it may.
 */
export function ensureComputer(reader: string): Promise<Computer> {
  const underway = starting.get(reader);
  if (underway) return underway;
  const next = bringUp(reader).finally(() => {
    starting.delete(reader);
    publish({ type: "changed" }); // it is no longer starting
  });
  starting.set(reader, next);
  return next;
}

async function bringUp(reader: string): Promise<Computer> {
  let saved = readerIn(await read(), reader).computer;
  const running = handle(saved);
  if (running) {
    if ((await check(reader)) === "running") return running;
    saved = readerIn(await read(), reader).computer;
  }
  publish({ type: "changed" }); // the pages read "starting"
  try {
    if (!saved) {
      const credentials = await Credentials.generate();
      // Saved before Create: they are the only way to start this Computer again, even
      // if Create fails after registering it.
      await update((data) => {
        readerIn(data, reader).computer = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0" };
      });
      return await attached(reader, await client().createComputer({ credentials, idleTimeoutSeconds: IDLE_SECONDS }));
    }
    const credentials = Credentials.parse(open(saved.credentials));
    try {
      return await attached(reader, await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    } catch (error) {
      // Still running somewhere this app lost track of (a binding never saved): stop
      // that one, then start from what it saved.
      if (!(error instanceof SandboxRetainedError || error instanceof ComputerAlreadyStartedError)) throw error;
      await client().stopComputer(saved.id);
      return await attached(reader, await client().startComputer(credentials, { idleTimeoutSeconds: IDLE_SECONDS }));
    }
  } catch (error) {
    const waiting =
      error instanceof CapacityExceededError
        ? "This project is running as many Computers as it may. This reader starts when one stops."
        : error instanceof CreateRateLimitedError
          ? "Too many Computers started this minute. This reader starts shortly."
          : null;
    if (!waiting) throw error;
    // A Create that was refused made nothing: forget the credentials saved for it.
    if (!saved) {
      await update((data) => {
        const record = readerIn(data, reader);
        if (record.computer && !record.computer.binding) delete record.computer;
      });
    }
    throw new Waiting(waiting);
  }
}

// A binding is saved only over an older one, so a slow reply from one Start can never
// overwrite the binding of a later one.
async function attached(reader: string, found: Computer): Promise<Computer> {
  const revision = found.bindingRevision;
  await update((data) => {
    const saved = readerIn(data, reader).computer;
    if (!saved || saved.id !== found.id) throw new Error("The saved Computer changed while it started.");
    if (saved.binding && BigInt(saved.bindingRevision) >= revision) return;
    saved.binding = seal(found.binding().serialize());
    saved.bindingRevision = revision.toString();
  });
  return found;
}

/** Looks at a running Computer: notes when it will idle out, or that it already has. */
export async function check(reader: string): Promise<"running" | "stopped"> {
  const found = await computer(reader);
  if (!found) return "stopped";
  try {
    const details = await found.sandboxDetails();
    const state = details.state.toLowerCase();
    if (state === "stopped" || state === "failed" || state === "terminated") {
      await released(reader);
      return "stopped";
    }
    const expiresAt = details.expiresAt?.toISOString();
    if (expiresAt !== readerIn(await read(), reader).computer?.expiresAt) {
      await update((data) => {
        const saved = readerIn(data, reader).computer;
        if (saved?.binding) saved.expiresAt = expiresAt;
      });
    }
    return "running";
  } catch (error) {
    // The sandbox record is gone: it stopped (idle, or from elsewhere).
    if (!(error instanceof NotFoundError)) throw error;
    await released(reader);
    return "stopped";
  }
}

/** Saves what the Computer can keep, then releases its sandbox and session. */
export async function stop(reader: string): Promise<void> {
  const found = await computer(reader);
  if (!found) return;
  stopping.add(reader);
  publish({ type: "changed" });
  try {
    // A stop that isn't confirmed is not a stop: keep the binding and say so.
    if (!(await found.stop())) throw new HttpError(502, "The Computer didn't confirm it stopped. Try again.");
    await released(reader);
  } finally {
    stopping.delete(reader);
    publish({ type: "changed" });
  }
}

/** The work a sandbox takes with it: a question can't be answered once it's gone. */
const ENDED_WITH_SANDBOX = new Set(["running", "canceling", "needs_input"]);

/** The sandbox is gone: its session closed, and a run still going, or still asking, ended with it. */
export async function released(reader: string): Promise<void> {
  await update((data) => {
    const found = readerIn(data, reader);
    if (found.computer) {
      found.computer.binding = "";
      delete found.computer.expiresAt;
    }
    delete found.session;
    delete found.driving;
    for (const run of data.runs) {
      if (run.reader === reader && ENDED_WITH_SANDBOX.has(run.state)) {
        Object.assign(run, { state: "stopped", summary: "Its Computer stopped before it finished.", endedAt: new Date().toISOString(), items: run.items ?? [] });
      }
    }
  });
}

// ---- runs: one session each -------------------------------------------------------

function sessionFrom(data: StoreData, run: string): { session: Session; computer: Computer; reader: ReaderRecord } | null {
  const reader = data.readers.find((r) => r.session?.run === run);
  const found = handle(reader?.computer);
  if (!reader?.session || !found || reader.session.bindingRevision !== found.bindingRevision.toString()) return null;
  return { session: found.adoptSession(run, open(reader.session.token)), computer: found, reader };
}

/** A run's open session, ready to drive, or null once its reader has moved on or stopped. */
export async function session(run: string): Promise<Session | null> {
  return sessionFrom(await read(), run)?.session ?? null;
}

/** The names a run's live screen goes by: null when its session is closed. */
export function liveName(data: StoreData, run: string): string | null {
  const reader = data.readers.find((r) => r.session?.run === run);
  return reader?.session && reader.computer?.binding && reader.session.bindingRevision === reader.computer.bindingRevision ? `${run}@${reader.session.bindingRevision}` : null;
}

/** The Computer a run's session is open on. */
export async function computerOf(run: string): Promise<{ reader: string; computer: Computer }> {
  const found = sessionFrom(await read(), run);
  if (!found) throw new HttpError(409, "This reader's session has ended. Its last screen and its steps are kept.");
  return { reader: found.reader.id, computer: found.computer };
}

/**
 * Opens a fresh session for a run on its reader's Computer. A reader keeps one session:
 * the one from its last run is closed first, so nothing of an earlier brief is in the
 * agent's memory or on its screen.
 */
export async function openSession(found: Computer, reader: string, run: string): Promise<Session> {
  const data = await read();
  const adopted = sessionFrom(data, run);
  if (adopted) return adopted.session;
  const previous = readerIn(data, reader).session;
  const revision = found.bindingRevision.toString();
  if (previous && previous.bindingRevision === revision) await found.destroySession(previous.run, { clean: true }).catch(() => undefined);

  let opened: Session;
  try {
    opened = await found.createSession({ name: run, label: run });
  } catch (error) {
    // Opened before but its token was never saved: open it again to get one.
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    await found.destroySession(run);
    opened = await found.createSession({ name: run, label: run });
  }
  // The Computer returns a session's token only here: keep it.
  await update((next) => {
    const record = readerIn(next, reader);
    record.session = { run, token: seal(opened.token), bindingRevision: revision };
    delete record.driving;
  });
  return opened;
}
