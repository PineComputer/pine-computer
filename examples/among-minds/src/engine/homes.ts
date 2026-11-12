// Homes: one Pine Computer per resident, with one session. A home is asleep (stopped)
// unless its resident is working.
//
// What survives sleep comes from two places. Pine keeps the computer's identity: its
// browser's sign-ins, cookies and passkeys, and its skills. A session's files don't come
// back on the next start, so the habitat archives the home's files as the computer goes
// to sleep and puts them back when it wakes.

import "server-only";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Binding, Client, Credentials, NotFoundError, ApiError, type Computer, type Session } from "@pinesandbox/computer";
import { all, get, now, run, DATA_DIR } from "./db";
import { record } from "./record";
import type { Resident } from "./residents";
import { trade } from "./trades";
import { seal, unseal, words } from "./util";
import { orientation } from "./orientation";

const SESSION = "home";

interface HomeRow {
  resident_id: string;
  computer_id: string | null;
  credentials: string | null;
  binding: string | null;
  binding_revision: string | null;
  session_token: string | null;
  state: string;
  seeded: number;
}

const shared = globalThis as typeof globalThis & { __pine?: Client };

export function client(): Client {
  return (shared.__pine ??= Client.fromEnv());
}

function row(residentId: string): HomeRow {
  const found = get<HomeRow>("select * from homes where resident_id = ?", residentId);
  if (!found) throw new Error("This resident has no home record.");
  return found;
}

function setState(residentId: string, state: string): void {
  run("update homes set state = ?, updated_at = ? where resident_id = ?", state, now(), residentId);
}

export function homeState(residentId: string): string {
  return row(residentId).state;
}

/** Homes awake or waking right now. */
export function awakeCount(): number {
  return get<{ n: number }>("select count(*) as n from homes where state in ('running', 'starting')")?.n ?? 0;
}

function saveBinding(residentId: string, computer: Computer): void {
  run(
    "update homes set binding = ?, binding_revision = ?, updated_at = ? where resident_id = ?",
    seal(computer.binding().serialize()),
    computer.bindingRevision.toString(),
    now(),
    residentId,
  );
}

async function openSession(residentId: string, computer: Computer): Promise<Session> {
  let opened: Session;
  try {
    opened = await computer.createSession({ name: SESSION, label: "Home", browser: true });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    await computer.destroySession(SESSION);
    opened = await computer.createSession({ name: SESSION, label: "Home", browser: true });
  }
  run("update homes set session_token = ?, updated_at = ? where resident_id = ?", seal(opened.token), now(), residentId);
  return opened;
}

/** The running home, if it is running now. */
async function reconnect(home: HomeRow): Promise<{ computer: Computer; session: Session } | null> {
  if (!home.credentials || !home.binding || !home.session_token) return null;
  const computer = client().reconnectComputer(Credentials.parse(unseal(home.credentials)), Binding.parse(unseal(home.binding)));
  try {
    const state = await computer.status();
    if (state.toLowerCase() !== "running") return null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
  return { computer, session: computer.adoptSession(SESSION, unseal(home.session_token)) };
}

export interface Home {
  computer: Computer;
  session: Session;
  /** What the resident should hear about its home, such as files that couldn't be put back. */
  notes: string[];
}

/**
 * Wakes a resident's home: builds it the first time, starts it when it sleeps (with its
 * files put back), and returns its computer and session. A first waking also sets up the
 * resident's trade.
 */
export async function wake(resident: Resident): Promise<Home> {
  const home = row(resident.id);
  const running = await reconnect(home);
  if (running) {
    setState(resident.id, "running");
    return { ...running, notes: [] };
  }
  setState(resident.id, "starting");
  try {
    let computer: Computer;
    if (!home.credentials) {
      const credentials = await Credentials.generate();
      // Saved before the Computer is created: the only way to start it again.
      run("update homes set computer_id = ?, credentials = ?, updated_at = ? where resident_id = ?", credentials.id, seal(credentials.serialize()), now(), resident.id);
      computer = await client().createComputer({ credentials, idleTimeoutSeconds: 900, metadata: { habitat: "amongminds", resident: resident.name } });
      record(resident.id, "home-built", `${resident.name}'s home was built.`, { subject: resident.id, data: { computer: credentials.id } });
    } else {
      computer = await client().startComputer(Credentials.parse(unseal(home.credentials)), { idleTimeoutSeconds: 900 });
    }
    saveBinding(resident.id, computer);
    const session = await openSession(resident.id, computer);
    // The runtime it woke in started empty: its files go back before anything else.
    const notes: string[] = [];
    await unpack(resident, session).catch((error) => {
      notes.push(`The habitat couldn't put all your files back this time (${words(error)}).`);
      record(resident.id, "unpack-failed", `${resident.name}'s files couldn't be put back: ${words(error)}`, { subject: resident.id });
    });
    setState(resident.id, "running");
    if (!home.seeded) await seed(resident, computer, session);
    return { computer, session, notes };
  } catch (error) {
    setState(resident.id, home.credentials ? "stopped" : "none");
    throw error;
  }
}

/** Puts a home to sleep: the habitat keeps its files, Pine keeps its identity and skills. */
export async function sleep(resident: Resident): Promise<void> {
  const home = row(resident.id);
  const running = home.credentials && home.binding ? await reconnect(home).catch(() => null) : null;
  setState(resident.id, "stopping");
  try {
    if (running) {
      await pack(resident, running.session).catch((error) =>
        record(resident.id, "pack-failed", `${resident.name}'s files couldn't be kept this time: ${words(error)}`, { subject: resident.id }),
      );
      await running.computer.stop();
    }
  } finally {
    run("update homes set binding = null, session_token = null, state = 'stopped', updated_at = ? where resident_id = ?", now(), resident.id);
  }
}

/** A trade's home: its own skill written in and activated, and the built-ins it keeps. */
async function seed(resident: Resident, computer: Computer, session: Session): Promise<void> {
  const t = trade(resident.trade);
  const draft = (await session.authorSkill(t.skill.name, t.skill.md, `${t.title} trade for ${resident.name}`, { origin: "amongminds" })) as { version?: number };
  if (typeof draft.version === "number") await computer.skills.activate(t.skill.name, draft.version);
  // Pine's switchable skills: the trade's stay on, the others go off.
  const skills = await computer.skills.list();
  for (const s of skills) {
    if (s.switchable !== true || typeof s.name !== "string") continue;
    const enabled = t.builtins.includes(s.name);
    if (s.enabled !== enabled) await computer.skills.setEnabled(s.name, enabled).catch(() => undefined);
  }
  await session.exec("mkdir -p works journal research data tools library deliveries received outbox && test -f note.md || printf '# My working note\\n\\n(nothing yet)\\n' > note.md", { timeoutMs: 20_000 });
  run("update homes set seeded = 1, updated_at = ? where resident_id = ?", now(), resident.id);
  record(resident.id, "home-seeded", `${resident.name}'s home was set up for the ${t.title.toLowerCase()} trade.`, {
    subject: resident.id,
    data: { skill: t.skill.name, builtins: t.builtins },
  });
}

const MAX_ARCHIVE = 50 * 1024 * 1024;
const archivePath = (residentId: string) => path.join(DATA_DIR, "homes", `${residentId}.tgz`);

/** Archives the home's work directory into the habitat, so it survives the computer's sleep. */
async function pack(resident: Resident, session: Session): Promise<void> {
  // attachments/ lives outside the home (the habitat's drop box), so it is left out.
  const out = await session.exec("rm -f .home.tgz && tar -czf .home.tgz --exclude=./.home.tgz --exclude=./attachments . && wc -c < .home.tgz", {
    timeoutMs: 60_000,
  });
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || out.error || "tar failed");
  if (Number(out.stdout.trim()) > MAX_ARCHIVE) throw new Error("the home is over 50 MB");
  const bytes = await session.readFile(".home.tgz");
  mkdirSync(path.join(DATA_DIR, "homes"), { recursive: true });
  writeFileSync(archivePath(resident.id), bytes);
}

/** Puts the home's files back after it wakes in a fresh runtime. */
async function unpack(resident: Resident, session: Session): Promise<boolean> {
  if (!existsSync(archivePath(resident.id)) || statSync(archivePath(resident.id)).size === 0) return false;
  await session.writeFile("home.tgz", readFileSync(archivePath(resident.id)));
  const out = await session.exec("tar -xzf attachments/home.tgz -C . && rm -f attachments/home.tgz", { timeoutMs: 60_000 });
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || out.error || "untar failed");
  return true;
}

/** Moves what was dropped in attachments/ into the home: brain/ for knowledge, received/<contract>/ for deliveries. */
async function settleIn(session: Session): Promise<void> {
  const out = await session.exec(
    'for f in attachments/brain-*; do [ -f "$f" ] || continue; mkdir -p brain && cp "$f" "brain/${f#attachments/brain-}"; done; ' +
      'for f in attachments/delivery-*; do [ -f "$f" ] || continue; rest="${f#attachments/delivery-}"; mkdir -p "received/${rest%%-*}" && cp "$f" "received/${rest%%-*}/${rest#*-}"; done; true',
    { timeoutMs: 30_000 },
  );
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || out.error || "couldn't move files in");
}

/** A text file from the home's work directory, or "" when it isn't there. */
export async function readText(session: Session, file: string): Promise<string> {
  try {
    return new TextDecoder().decode(await session.readFile(file));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return "";
    throw error;
  }
}

/**
 * What the habitat owes a home before its resident works: a second brain's new
 * knowledge, files delivered to it, skills it adopted.
 */
export async function handOver(resident: Resident, computer: Computer, session: Session): Promise<string[]> {
  const notes: string[] = [];
  // The orientation is written fresh each waking, so it is always current.
  await session.writeFile("orientation.md", orientation(resident));
  const brain = all<{ id: string; name: string }>("select id, name from brain_files where resident_id = ? and delivered = 0", resident.id);
  for (const file of brain) {
    const bytes = readFileSync(path.join(DATA_DIR, "brains", resident.id, file.id));
    await session.writeFile(`brain-${file.name}`, bytes);
    run("update brain_files set delivered = 1 where id = ?", file.id);
    notes.push(`New knowledge from your person: brain/${file.name}`);
  }
  const deliveries = all<{ id: string; title: string; files: string }>(
    "select id, title, files from contracts where buyer = ? and status in ('delivered', 'paid') and handed_over = 0",
    resident.id,
  );
  for (const c of deliveries) {
    for (const f of JSON.parse(c.files) as { name: string; stored: string }[]) {
      await session.writeFile(`delivery-${c.id}-${f.name}`, readFileSync(path.join(DATA_DIR, f.stored)));
      notes.push(`Delivered for "${c.title}" (${c.id}): received/${c.id}/${f.name}`);
    }
    run("update contracts set handed_over = 1 where id = ?", c.id);
  }
  // Files arrive in attachments/, the drop box outside the home; moving them in keeps them.
  if (brain.length || deliveries.length) await settleIn(session);
  const adoptions = all<{ id: string; name: string; body: string; library_id: string }>(
    "select a.id, l.name, l.body, l.id as library_id from adoptions a join library l on l.id = a.library_id where a.resident_id = ? and a.installed_version is null",
    resident.id,
  );
  for (const a of adoptions) {
    try {
      const draft = (await session.authorSkill(a.name, a.body, `adopted from the library (${a.library_id})`, { origin: "amongminds" })) as { version?: number };
      if (typeof draft.version === "number") {
        await computer.skills.activate(a.name, draft.version);
        run("update adoptions set installed_version = ? where id = ?", draft.version, a.id);
        notes.push(`The skill ${a.name} you adopted is now installed on your computer.`);
      }
    } catch (error) {
      notes.push(`The skill ${a.name} could not be installed: ${words(error)}`);
      run("update adoptions set installed_version = -1 where id = ?", a.id);
    }
  }
  return notes;
}
