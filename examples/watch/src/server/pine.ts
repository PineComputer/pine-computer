// The desk's one Computer, as the server SDK sees it: rebuilt from the saved records on
// every call, so a restart of this server picks up where the last process stopped.
//
// It runs only while a check does. A check starts it (or creates it, the first time),
// and the worker stops it when no check is left. A stopped Computer keeps no tabs and
// no session: each Start opens a fresh session, and what a check learned is already in
// this app's store.

import "server-only";
import { Binding, Client, Credentials, NotFoundError, type Computer, type Session } from "@pinesandbox/computer";
import { open, readUser, seal, updateUser, type ComputerRecord } from "./store";

/** The one session every check runs in: a browser and the agent. */
export const DESK = "desk";

/** How long the Computer may sit unused before it stops itself: time for a person to sign in. */
const IDLE_SECONDS = 600;

const shared = globalThis as typeof globalThis & { __pine?: Client };

/** Reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. */
export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

/** The Computer, ready to call, or null before it exists or while it is stopped. */
export async function computer(user: string): Promise<Computer | null> {
  return handle((await readUser(user)).computer);
}

/** The desk session, ready to drive, or null while the Computer is stopped. */
export async function session(user: string): Promise<Session | null> {
  const saved = (await readUser(user)).computer;
  const found = handle(saved);
  if (!found || !saved?.session) return null;
  return found.adoptSession(DESK, open(saved.session));
}

/** Whether the sandbox the saved binding names is still there and running. */
export async function alive(user: string): Promise<boolean> {
  const found = await computer(user);
  if (!found) return false;
  try {
    return (await found.sandboxDetails()).state.toLowerCase() === "running";
  } catch (error) {
    // The sandbox record is gone: it stopped (idle, or from elsewhere).
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}

/**
 * The desk session on a running Computer: as it is, or after creating the Computer (the
 * first time) or starting it from stopped.
 */
export async function ensureRunning(user: string): Promise<Session> {
  if (await alive(user)) {
    const ready = await session(user);
    if (ready) return ready;
  } else {
    await released(user);
  }
  let saved = (await readUser(user)).computer;
  let started: Computer;
  if (!saved) {
    const credentials = await Credentials.generate();
    saved = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0", state: "starting" };
    // Saved before Create: they are the only way to start this Computer again, even if
    // Create fails after registering it.
    const record = saved;
    await updateUser(user, (data) => void (data.computer = record));
    started = await client().createComputer({ credentials, idleTimeoutSeconds: IDLE_SECONDS });
  } else if (saved.binding) {
    // Running, but its session token was never saved: open the session again below.
    started = handle(saved)!;
  } else {
    await setState(user, "starting");
    try {
      started = await client().startComputer(Credentials.parse(open(saved.credentials)), { idleTimeoutSeconds: IDLE_SECONDS });
    } catch (error) {
      await setState(user, "stopped");
      throw error;
    }
  }
  // A Start begins with no sessions; the Computer returns a session's token only here.
  if (saved.binding) await started.destroySession(DESK).catch(() => undefined);
  const opened = await started.createSession({ name: DESK, label: "Watch desk", browser: true });
  await updateUser(user, (data) => {
    const record = data.computer;
    if (!record || record.id !== started.id) throw new Error("The saved Computer changed while it started.");
    // A binding is saved only over an older one, so a slow reply from one Start can
    // never overwrite the binding of a later one.
    if (!record.binding || BigInt(record.bindingRevision) < started.bindingRevision) {
      record.binding = seal(started.binding().serialize());
      record.bindingRevision = started.bindingRevision.toString();
    }
    record.session = seal(opened.token);
    record.state = "running";
    record.driving = false;
  });
  return opened;
}

/** Stops the Computer between checks. False means the stop isn't confirmed: try again. */
export async function stop(user: string): Promise<boolean> {
  const found = await computer(user);
  if (!found) {
    await released(user);
    return true;
  }
  await setState(user, "stopping");
  let stopped = false;
  try {
    stopped = await found.stop();
  } catch (error) {
    // Already gone counts as stopped; anything else is tried again on the next tick.
    stopped = !(await alive(user).catch(() => true));
    if (!stopped) console.error("stop:", error);
  }
  if (stopped) await released(user);
  else await setState(user, "running");
  return stopped;
}

/** The sandbox is gone: its session closed with it. */
export async function released(user: string): Promise<void> {
  const saved = (await readUser(user)).computer;
  if (!saved || (!saved.binding && saved.state === "stopped")) return;
  await updateUser(user, (data) => {
    if (!data.computer) return;
    data.computer.binding = "";
    delete data.computer.session;
    data.computer.state = "stopped";
    data.computer.driving = false;
  });
}

async function setState(user: string, state: ComputerRecord["state"]): Promise<void> {
  await updateUser(user, (data) => {
    if (data.computer) data.computer.state = state;
  });
}

/** A person takes the controls of the desk session, or hands them back. */
export async function control(user: string, action: "take" | "release"): Promise<void> {
  const found = await computer(user);
  if (!found) return;
  if (action === "take") await found.takeControl(DESK);
  else await found.releaseControl(DESK);
  await updateUser(user, (data) => {
    if (data.computer) data.computer.driving = action === "take";
  });
}
