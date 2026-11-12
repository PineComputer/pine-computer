// The Computer, as the server SDK sees it: rebuilt from the saved records on every
// request, so any server process (or a restart) picks up where the last one left off.
// Nothing is cached but the Client and what a binding can do.

import "server-only";
import { randomBytes } from "node:crypto";
import {
  ApiError,
  Binding,
  Client,
  Credentials,
  NotFoundError,
  type AttachOptions,
  type Computer,
  type ComputerLocation,
  type Session,
} from "@pinesandbox/computer";
import type { Capabilities, ComputerView } from "@/shared/api";
import { HttpError } from "./http";
import { open, readUser, seal, updateUser, type ComputerRecord, type UserData } from "./store";

/** Every Computer starts with this session; people add more beside it. */
export const MAIN = { name: "main", label: "Main" };

const shared = globalThis as typeof globalThis & { __pine?: Client; __capabilities?: Map<string, Capabilities> };

/** Reads PINE_SANDBOX_ENDPOINT and PINE_SANDBOX_API_KEY. */
export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

/** The user's Computer, ready to call, or null before it exists or while it has no sandbox. */
export async function computer(user: string): Promise<Computer | null> {
  return handle((await readUser(user)).computer);
}

export async function requireComputer(user: string): Promise<Computer> {
  const found = await computer(user);
  if (!found) throw new HttpError(409, "Start the Computer first.");
  return found;
}

function sessionFrom(data: UserData, name: string): Session | null {
  const found = handle(data.computer);
  const saved = data.sessions.find((s) => s.name === name);
  if (!found || !saved?.token || saved.bindingRevision !== found.bindingRevision.toString()) return null;
  return found.adoptSession(saved.name, open(saved.token));
}

/** One of the user's open sessions, ready to drive, or null. */
export async function session(user: string, name: string): Promise<Session | null> {
  return sessionFrom(await readUser(user), name);
}

export async function requireSession(user: string, name: string): Promise<Session> {
  const found = await session(user, name);
  if (!found) throw new HttpError(409, "This session isn't open. Start the Computer first.");
  return found;
}

const where = (location: ComputerLocation | undefined) => (!location ? undefined : "mode" in location && location.mode === "direct" ? "direct" : location.country);
const toLocation = (value: string | undefined): ComputerLocation | undefined =>
  !value ? undefined : value === "direct" ? { mode: "direct" } : { country: value };

/** The Computer as the page shows it: its state, where it is and how long it has. */
export async function overview(user: string): Promise<ComputerView | null> {
  const saved = (await readUser(user)).computer;
  if (!saved) return null;
  const view: ComputerView = { id: saved.id, state: "stopped", location: saved.location, idleTimeoutSeconds: saved.idleTimeoutSeconds, canPause: !saved.pauseUnavailable };
  const found = handle(saved);
  if (!found) return view;
  try {
    const details = await found.sandboxDetails();
    const lifetime = details.lifetime;
    return {
      ...view,
      state: details.state.toLowerCase(),
      sandboxId: details.sandboxId,
      createdAt: details.createdAt?.toISOString(),
      expiresAt: details.expiresAt?.toISOString(),
      lifetime: lifetime && {
        idleTimeoutSeconds: lifetime.idleTimeoutSeconds,
        minIdleTimeoutSeconds: lifetime.minIdleTimeoutSeconds,
        maxIdleTimeoutSeconds: lifetime.maxIdleTimeoutSeconds,
        maxRuntimeAgeSeconds: lifetime.maxRuntimeAgeSeconds,
        stopAt: lifetime.stopAt?.toISOString(),
        deadline: lifetime.deadline?.toISOString(),
      },
      problem: details.state.toLowerCase() === "failed" ? details.message || "The sandbox failed." : undefined,
    };
  } catch (error) {
    // The sandbox record is gone: it stopped (idle, or from elsewhere). Start restores it.
    if (error instanceof NotFoundError) return view;
    throw error;
  }
}

function attachOptions(saved: ComputerRecord): AttachOptions {
  return { location: toLocation(saved.location), idleTimeoutSeconds: saved.idleTimeoutSeconds };
}

/** Creates the user's Computer and opens its first session. */
export async function create(user: string, choice: { location?: string; idleTimeoutSeconds?: number }): Promise<void> {
  if ((await readUser(user)).computer) throw new HttpError(409, "You already have a Computer.");
  const credentials = await Credentials.generate();
  const record: ComputerRecord = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0", ...choice };
  // Saved before Create: they are the only way to start this Computer again, even if
  // Create fails after registering it.
  await updateUser(user, (data) => {
    data.computer = record;
    data.sessions = [];
  });
  await attached(user, await client().createComputer({ credentials, ...attachOptions(record) }));
}

/** Starts the stopped Computer from its saved state, with the sessions it had. */
export async function start(user: string): Promise<void> {
  const saved = (await readUser(user)).computer;
  if (!saved) throw new HttpError(409, "Create a Computer first.");
  await attached(user, await client().startComputer(Credentials.parse(open(saved.credentials)), attachOptions(saved)));
}

/** Gives up on a failed sandbox and starts again from saved state. */
export async function recover(user: string): Promise<void> {
  const saved = (await readUser(user)).computer;
  if (!saved) throw new HttpError(409, "Create a Computer first.");
  await attached(user, await client().recoverComputer(Credentials.parse(open(saved.credentials)), attachOptions(saved)));
}

/** Saves what the Computer can keep, then releases its sandbox and sessions. */
export async function stop(user: string): Promise<boolean> {
  const found = await computer(user);
  if (!found) return true;
  const stopped = await found.stop();
  if (stopped) await released(user);
  return stopped;
}

/** The turns a sandbox takes with it: a question can't be answered once it's gone. */
const ENDED_WITH_RUNTIME = new Set(["running", "canceling", "needs_input"]);

/** Deletes the Computer for good: its sandbox, saved state, sign-ins and skills. The app's history stays. */
export async function destroy(user: string): Promise<void> {
  const saved = (await readUser(user)).computer;
  if (!saved) return;
  await client().deleteComputer(saved.id);
  await updateUser(user, (data) => {
    delete data.computer;
    data.sessions = [];
    for (const turn of data.turns) if (ENDED_WITH_RUNTIME.has(turn.state)) turn.state = "stopped";
  });
}

/** The sandbox is gone: its sessions closed, and a turn still running, or still asking, ended with it. */
export async function released(user: string): Promise<void> {
  await updateUser(user, (data) => {
    if (data.computer) data.computer.binding = "";
    for (const s of data.sessions) {
      delete s.token;
      delete s.bindingRevision;
    }
    for (const turn of data.turns) if (ENDED_WITH_RUNTIME.has(turn.state)) turn.state = "stopped";
  });
}

async function attached(user: string, found: Computer): Promise<void> {
  await saveBinding(user, found);
  // A Start begins with no sessions: open the ones this user works in.
  const { sessions } = await readUser(user);
  for (const s of sessions.length ? sessions : [MAIN]) await openSession(user, found, s.name, s.label);
}

// A binding is saved only over an older one, so a slow reply from one Start can never
// overwrite the binding of a later one.
async function saveBinding(user: string, found: Computer): Promise<void> {
  const revision = found.bindingRevision;
  await updateUser(user, (data) => {
    const saved = data.computer;
    if (!saved || saved.id !== found.id) throw new Error("The saved Computer changed while it started.");
    if (saved.binding && BigInt(saved.bindingRevision) >= revision) return;
    saved.binding = seal(found.binding().serialize());
    saved.bindingRevision = revision.toString();
    saved.location = where(found.location) ?? saved.location;
  });
}

/** Opens a session and keeps its token: the Computer returns it only here. */
export async function openSession(user: string, found: Computer, name: string, label: string): Promise<Session> {
  let opened: Session;
  try {
    opened = await found.createSession({ name, label, browser: true });
  } catch (error) {
    // Opened before but its token was never saved: open it again to get one.
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    await found.destroySession(name);
    opened = await found.createSession({ name, label, browser: true });
  }
  await updateUser(user, (data) => {
    const record = { name, label, token: seal(opened.token), bindingRevision: found.bindingRevision.toString() };
    const existing = data.sessions.find((s) => s.name === name);
    if (existing) Object.assign(existing, record);
    else data.sessions.push({ ...record, createdAt: new Date().toISOString() });
  });
  return opened;
}

/** A new session beside the others, up to what the Computer runs at once. */
export async function addSession(user: string, label: string): Promise<string> {
  const found = await requireComputer(user);
  const { sessions } = await capabilities(user);
  const open = (await readUser(user)).sessions.filter((s) => s.token).length;
  if (open >= sessions) throw new HttpError(409, `This Computer runs up to ${sessions} sessions at once.`);
  const name = `s-${randomBytes(3).toString("hex")}`;
  await openSession(user, found, name, label);
  return name;
}

/** Closes a session: its browser, shell and work directory go, and so does its history here. */
export async function closeSession(user: string, name: string): Promise<void> {
  const data = await readUser(user);
  if (data.sessions.length <= 1) throw new HttpError(409, "Keep at least one session.");
  if (sessionFrom(data, name)) await handle(data.computer)!.destroySession(name, { clean: true });
  await updateUser(user, (next) => {
    next.sessions = next.sessions.filter((s) => s.name !== name);
    next.turns = next.turns.filter((t) => t.session !== name);
  });
}

/** What this binding can do and its limits, from the Computer; asked once per Start. */
export async function capabilities(user: string): Promise<Capabilities> {
  const found = await requireComputer(user);
  const cache = (shared.__capabilities ??= new Map());
  const cacheKey = `${found.id}:${found.bindingRevision}`;
  const known = cache.get(cacheKey);
  if (known) return known;
  const raw = (await found.capabilities()) as {
    features?: { id: string; title: string; description: string }[];
    limits?: { id: string; description: string; value: number; unit: string; scope: string; kind: string }[];
  };
  const limits = raw.limits ?? [];
  const result: Capabilities = {
    features: raw.features ?? [],
    limits,
    sessions: limits.find((l) => l.id === "sessions.concurrent")?.value ?? 3,
  };
  cache.set(cacheKey, result);
  return result;
}
