// The Computer the PAL works through, as the server SDK sees it: rebuilt from the saved records on every
// request, so a restart carries on where the last process stopped. One Computer, one session ("claims").

import "server-only";
import { Binding, Client, Credentials, NotFoundError, SandboxRetainedError, type Computer, type Session } from "@pinesandbox/computer";
import type { ComputerView } from "@/shared/api";
import { publish } from "./live";
import { open, read, seal, update, type ComputerRecord } from "./store";

export const SESSION = "claims";
/** A question can wait only while the Computer runs, and waiting isn't work: keep it up across a call-back. */
const IDLE = Number(process.env.DEMO_IDLE_TIMEOUT_SECONDS ?? 3600);

const shared = globalThis as typeof globalThis & { __demoClient?: Client; __demoEnsure?: Promise<Ready> };

export function client(): Client {
  return (shared.__demoClient ??= Client.fromEnv());
}

function handle(saved: ComputerRecord | undefined): Computer | null {
  if (!saved?.binding) return null;
  return client().reconnectComputer(Credentials.parse(open(saved.credentials)), Binding.parse(open(saved.binding)));
}

/** The Computer, ready to call, or null when there's none or it has no sandbox. */
export async function computer(): Promise<Computer | null> {
  return handle((await read()).computer);
}

/** The claims session, or null when it isn't open under the current binding. */
export async function session(): Promise<Session | null> {
  const data = await read();
  const found = handle(data.computer);
  const saved = data.session;
  if (!found || !saved || saved.bindingRevision !== found.bindingRevision.toString()) return null;
  return found.adoptSession(saved.name, open(saved.token));
}

export interface Ready {
  computer: Computer;
  session: Session;
}

/** Creates, starts or resumes the Computer as needed, and opens the claims session. One at a time. */
export function ensure(): Promise<Ready> {
  const pending = shared.__demoEnsure;
  if (pending) return pending;
  const next = prepare().finally(() => {
    shared.__demoEnsure = undefined;
  });
  shared.__demoEnsure = next;
  return next;
}

async function prepare(): Promise<Ready> {
  publish({ type: "computer", computer: { state: "starting" } });
  const data = await read();
  let found: Computer | null = null;
  if (!data.computer) {
    const credentials = await Credentials.generate();
    // Saved before Create: they're the only way to start this Computer again.
    await update((d) => {
      d.computer = { id: credentials.id, credentials: seal(credentials.serialize()), binding: "", bindingRevision: "0" };
      delete d.session;
    });
    found = await client().createComputer({ credentials, idleTimeoutSeconds: IDLE });
  } else {
    found = handle(data.computer);
    if (found) {
      try {
        const state = (await found.status()).toLowerCase();
        if (state === "paused") await found.resume();
        else if (!["running", "resuming", "starting"].includes(state)) found = null;
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        found = null;
      }
    }
    if (!found) {
      const credentials = Credentials.parse(open(data.computer.credentials));
      try {
        found = await client().startComputer(credentials, { idleTimeoutSeconds: IDLE });
      } catch (error) {
        if (!(error instanceof SandboxRetainedError)) throw error;
        // Still held by a sandbox this app lost track of: give it up and start from saved state.
        found = await client().recoverComputer(credentials, { idleTimeoutSeconds: IDLE });
      }
    }
  }
  await saveBinding(found);
  const opened = await openSession(found);
  await keepUp(found);
  publish({ type: "computer", computer: await view() });
  return { computer: found, session: opened };
}

async function saveBinding(found: Computer): Promise<void> {
  const revision = found.bindingRevision;
  await update((d) => {
    const saved = d.computer;
    if (!saved || saved.id !== found.id) throw new Error("The saved Computer changed while it started.");
    if (saved.binding && BigInt(saved.bindingRevision) >= revision) return;
    saved.binding = seal(found.binding().serialize());
    saved.bindingRevision = revision.toString();
  });
}

async function openSession(found: Computer): Promise<Session> {
  const saved = (await read()).session;
  if (saved && saved.bindingRevision === found.bindingRevision.toString()) return found.adoptSession(saved.name, open(saved.token));
  let opened: Session;
  try {
    opened = await found.createSession({ name: SESSION, label: "Warranty claims" });
  } catch (error) {
    // Opened before but its token was lost: open it again to get one.
    if ((error as { status?: number }).status !== 409) throw error;
    await found.destroySession(SESSION);
    opened = await found.createSession({ name: SESSION, label: "Warranty claims" });
  }
  await update((d) => {
    d.session = { name: opened.name, token: seal(opened.token), bindingRevision: found.bindingRevision.toString() };
  });
  return opened;
}

/**
 * A new case starts in a new session: no tabs, files or agent memory from the last one. Sign-ins belong to
 * the Computer, so the new session is still signed in. Null when the Computer isn't running.
 */
export async function freshSession(): Promise<Session | null> {
  const found = await computer();
  if (!found) return null;
  await update((d) => void delete d.session);
  await found.destroySession(SESSION, { clean: true }).catch((error) => {
    if ((error as { status?: number }).status !== 404) throw error;
  });
  return openSession(found);
}

/** The longest idle timeout the project allows, up to DEMO_IDLE_TIMEOUT_SECONDS. */
async function keepUp(found: Computer): Promise<void> {
  try {
    // Without a project lifetime policy there's nothing to change: the timeout given at Start applies.
    const details = await found.sandboxDetails();
    if (!details.lifetime) return;
    const want = Math.min(IDLE, details.lifetime.maxIdleTimeoutSeconds ?? IDLE);
    if (details.lifetime.idleTimeoutSeconds !== want) await found.setIdleTimeout(want);
  } catch {
    // Keep the default: the Computer works either way.
  }
}

export async function view(): Promise<ComputerView> {
  const data = await read();
  if (!data.computer) return { state: "none" };
  const found = handle(data.computer);
  if (!found) return { state: "stopped" };
  try {
    const details = await found.sandboxDetails();
    return {
      state: details.state.toLowerCase(),
      session: data.session?.bindingRevision === found.bindingRevision.toString() ? SESSION : undefined,
      idleTimeoutSeconds: details.lifetime?.idleTimeoutSeconds ?? IDLE,
      // Work pushes this out; a question waiting for an answer doesn't.
      stopAt: (details.lifetime?.stopAt ?? details.expiresAt)?.toISOString(),
    };
  } catch (error) {
    if (error instanceof NotFoundError) return { state: "stopped" };
    throw error;
  }
}

/** Saves what the Computer keeps (sign-ins, skills), then releases its sandbox and session. */
export async function stop(): Promise<void> {
  const found = await computer();
  if (found && !(await found.stop())) throw new Error("Stop is unconfirmed. Try again.");
  await update((d) => {
    if (d.computer) d.computer.binding = "";
    delete d.session;
    if (d.claim && (d.claim.state === "working" || d.claim.state === "needs_input")) d.claim.state = "stopped";
  });
  publish({ type: "computer", computer: { state: "stopped" } });
}
