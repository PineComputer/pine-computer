// A chat thread handed to a Computer. Each thread has its own session on the Computer, so its agent
// remembers the thread's earlier jobs and keeps its tabs and files, while the sign-ins are shared. A
// message either starts a job or, when the agent stopped on a question, answers it. The thread follows
// the job to its end and reports each step on the way.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ApiError, NotFoundError, type AgentActivity, type AgentTurn, type Session } from "@pinesandbox/computer";
import { ensureComputer, existingSession, markSession, openSession } from "./computer.js";
import { log, safe } from "./home.js";
import { own, scope, store } from "./store.js";

export interface Exchange {
  at: string;
  prompt: string;
  reply: string;
  state: string;
  cost: number | null;
  files: string[];
}

export interface ThreadRecord {
  id: string;
  computer: string;
  /** The session's name on the Computer. */
  session: string;
  title?: string;
  /** Where returned files go: the app's working folder for the thread. */
  cwd?: string;
  createdAt: string;
  history: Exchange[];
  /** The job in flight. Saved before it is sent, so a process that didn't start the job can follow it to its end. */
  job?: {
    /** Names the job, and its submission to the platform. */
    key: string;
    how: "run" | "answer" | "steer";
    goal: string;
    prompt: string;
    fresh: boolean;
    /** Where the session stood before the job was sent. */
    since: { taskId?: string; turnId?: string; eventId?: number };
    /** The turn it became, once the platform has said. */
    turnId?: string;
    taskId?: string;
    cursor?: number;
  };
}

export interface SavedFile {
  path: string;
  name: string;
  size: number;
}

export interface Outcome {
  state: "completed" | "needs_input" | "failed" | "canceled";
  /** The agent's summary, or its question. Markdown. */
  text: string;
  files: SavedFile[];
  cost: number | null;
  turnId: string;
  /** True when the session opened empty: a new thread, or a Computer that restarted. */
  fresh: boolean;
}

export interface Listener {
  /** The bridge's own steps: starting the Computer, opening the session, uploading. */
  step(text: string): void;
  /** One of the agent's steps, upserted by id. */
  activity(activity: AgentActivity): void;
  progress(text: string): void;
}

export const readThread = (id: string) => store().get<ThreadRecord>(["threads", id]);
export const saveThread = (t: ThreadRecord) => store().set(["threads", t.id], t);

/** The titles of a Computer's threads, by session, for the desktop page. */
export async function titlesOf(computer: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const id of await store().list(["threads"])) {
    const t = await readThread(id);
    if (t?.computer === computer && t.title) titles.set(t.session, t.title);
  }
  return titles;
}

export function newThread(computer: string, cwd?: string): ThreadRecord {
  const id = randomUUID();
  return { id, computer, session: `chat-${id.slice(0, 8)}`, cwd, createdAt: new Date().toISOString(), history: [] };
}

/** Secrets the agent types without the model seeing them: PINE_SECRET_<NAME>=value, used as $NAME. */
export function secrets(): Record<string, string> {
  const out: Record<string, string> = {};
  // The environment is this machine's owner's. A hosted project is someone else.
  if (scope()) return out;
  for (const [key, value] of Object.entries(process.env)) {
    const name = key.match(/^PINE_SECRET_([A-Z0-9_]+)$/)?.[1];
    if (name && value) out[name] = value;
  }
  return out;
}

function context(thread: ThreadRecord, fresh: boolean, sent?: string): string {
  const lines = [
    "You are the computer behind an assistant in a chat app. The person writes to you there, and your summary is shown to them as your reply: write it for them in a few plain lines, what you did and what you found, and link any file you made.",
    "If you need something only they can give (a code, a choice, a missing detail), or before anything that spends money, sends a message or submits on their behalf, stop and ask one clear question.",
  ];
  if (sent) lines.push(`They sent this message ${sent}; read times and dates in their time zone.`);
  const names = Object.keys(secrets());
  if (names.length) lines.push(`Saved secrets you can type by name, never ask for them and never show them: ${names.map((n) => `$${n}`).join(", ")}.`);
  // A session that opened empty on an old thread lost the agent's memory of it: carry the gist over.
  if (fresh && thread.history.length) {
    const recap = thread.history.slice(-4).map((x) => `- They asked: ${x.prompt.slice(0, 300)}\n  You replied (${x.state}): ${x.reply.slice(0, 400)}`);
    lines.push(`Earlier in this thread (your workspace from then is gone; your sign-ins are not):\n${recap.join("\n")}`);
  }
  if (process.env.PINE_CONTEXT) lines.push(process.env.PINE_CONTEXT);
  return lines.join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["completed", "needs_input", "failed", "canceled"]);

/** Hands one message to the thread's Computer and follows the job until it ends or asks. */
/** `sent`: when the person sent the message, in their own time zone, as the chat app says it. `newJob`: the
 * message starts a job of its own even when the agent is waiting on a question (an A2A client's new task). */
export interface WorkOptions {
  files?: string[];
  sent?: string;
  newJob?: boolean;
  on: Listener;
  signal?: AbortSignal;
}

/** Drops the question the thread's agent is waiting on, so the next message starts a new job. */
export async function dropQuestion(thread: ThreadRecord): Promise<void> {
  const session = await existingSession(thread.computer, thread.session);
  const status = await session?.agent.status().catch(() => undefined);
  if (status?.turn?.state === "needs_input") await session!.agent.cancel(status.turn.turnId);
}

export async function work(thread: ThreadRecord, prompt: string, options: WorkOptions): Promise<Outcome> {
  const { on, signal } = options;
  const computer = await ensureComputer(thread.computer, on.step);
  const { session, fresh } = await openSession(computer, thread.computer, thread.session, thread.title ?? "Chat");
  await markSession(thread.computer, thread.session, true);
  try {
    return await job(thread, session, fresh, prompt, options);
  } finally {
    await markSession(thread.computer, thread.session, false);
  }
}

async function job(thread: ThreadRecord, session: Session, fresh: boolean, prompt: string, options: WorkOptions): Promise<Outcome> {
  const { on, signal } = options;
  signal?.throwIfAborted();

  let goal = prompt;
  const uploaded = await upload(session, options.files ?? [], on);
  if (uploaded.length) goal += `\n\nFiles from the person, in your workspace: ${uploaded.join(", ")}`;

  let before = await session.agent.status().catch(ignoreMissing);
  if (options.newJob && before?.turn?.state === "needs_input") {
    await session.agent.cancel(before.turn.turnId);
    before = await session.agent.status().catch(ignoreMissing);
  }
  const how = before?.turn?.state === "needs_input" ? "answer" : before?.turn?.state === "running" ? "steer" : "run";
  // Written down before it is sent: a process that dies in between leaves enough to find the turn again.
  thread.job = { key: randomUUID(), how, goal, prompt, fresh, since: { taskId: before?.taskId, turnId: before?.turn?.turnId, eventId: before?.turn?.lastEventId } };
  await saveThread(thread);
  const turn = await send(thread, session, options.sent);
  return conclude(thread, session, turn, options);
}

/** Sends the thread's job as written down, and records the turn it became. Safe to do twice. */
async function send(thread: ThreadRecord, session: Session, sent?: string): Promise<AgentTurn> {
  const { key, how, goal, fresh, since } = thread.job!;
  let turn: AgentTurn;
  if (how === "answer") {
    turn = await session.agent.answer(since.turnId!, goal, { secrets: secrets() });
  } else if (how === "steer") {
    // Still on a job a process that went away started: the message joins it.
    turn = await session.agent.steer(since.turnId!, goal, { secrets: secrets() });
  } else {
    // The key names this submission: sent again, the platform answers with the turn it already started.
    turn = await session.agent.run(goal, { context: context(thread, fresh, sent), secrets: secrets(), idempotencyKey: key });
  }
  const { taskId } = await session.agent.status();
  thread.job = { ...thread.job!, turnId: turn.turnId, taskId, cursor: since.taskId === taskId ? since.eventId : undefined };
  await saveThread(thread);
  return turn;
}

/**
 * Follows the thread's job in flight to its end, from a process that may not have started it: the steps
 * from the turn's start, then the result. Null when the thread has no job in flight.
 */
export async function resume(thread: ThreadRecord, options: Pick<WorkOptions, "on" | "signal">): Promise<Outcome | null> {
  if (!thread.job) return null;
  const { key, how, prompt, fresh } = thread.job;
  const session = await existingSession(thread.computer, thread.session);
  if (session) {
    try {
      let turn = thread.job.turnId ? ({ turnId: thread.job.turnId } as AgentTurn) : undefined;
      if (!turn && how === "run") turn = await send(thread, session);
      if (!turn) {
        // An answer or a nudge that may not have arrived: the turn it was for says where things stand.
        const now = await session.agent.status().catch(ignoreMissing);
        if (now?.turn) {
          thread.job = { ...thread.job, turnId: now.turn.turnId, taskId: now.taskId, cursor: thread.job.since.eventId };
          await saveThread(thread);
          turn = now.turn;
        }
      }
      if (turn) return await conclude(thread, session, turn, options);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  // The Computer restarted under the job: its session, and the turn in it, are gone.
  const text = "The computer restarted before this job ended, so its result is lost. Send it again to start over.";
  await settle(thread, key, { at: new Date().toISOString(), prompt, reply: text, state: "failed", cost: null, files: [] });
  return { state: "failed", text, files: [], cost: null, turnId: thread.job?.turnId ?? "", fresh };
}

/** Writes a job's end into the thread, once: two processes may have followed the same job. */
async function settle(thread: ThreadRecord, key: string, exchange: Exchange): Promise<void> {
  await store().lock(`thread-${thread.id}`, async () => {
    const saved = await readThread(thread.id);
    delete thread.job;
    if (saved && saved.job?.key !== key) {
      thread.history = saved.history;
      return;
    }
    thread.history.push(exchange);
    thread.history = thread.history.slice(-20);
    await saveThread(thread);
  });
}

async function conclude(thread: ThreadRecord, session: Session, turn: AgentTurn, options: Pick<WorkOptions, "on" | "signal">): Promise<Outcome> {
  const { on, signal } = options;
  const { key, cursor, prompt, fresh } = thread.job!;
  const taskId = thread.job!.taskId!;

  const stopFollowing = new AbortController();
  const following = follow(session, taskId, cursor, on, stopFollowing.signal);
  const onAbort = () => void session.agent.cancel(turn.turnId).catch((error) => log("cancel:", error));
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      try {
        turn = await session.agent.wait(turn.turnId, { timeoutMs: 25_000 });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        log("wait failed, retrying:", error);
        await sleep(2_000);
        continue;
      }
      if (turn.state === "answered" && turn.nextTurnId) {
        turn = { ...turn, turnId: turn.nextTurnId };
        continue;
      }
      if (TERMINAL.has(turn.state)) break;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Steps that ended just before the turn did may still be on their way.
    await sleep(800);
    stopFollowing.abort();
    await following;
  }

  const state = turn.state as Outcome["state"];
  const files = state === "completed" ? await collect(session, turn, thread) : [];
  const said = (turn.state === "needs_input" ? turn.question || turn.result?.summary : turn.result?.summary)?.trim() || defaultText(state);
  const text = localize(said, files);
  const cost = turn.result?.usage.cost.total ?? null;
  await settle(thread, key, { at: new Date().toISOString(), prompt, reply: text, state, cost, files: files.map((f) => f.path) });
  return { state, text, files, cost, turnId: turn.turnId, fresh };
}

/** The agent links its files by their place on the Computer; the person opens the copies here. */
function localize(text: string, files: SavedFile[]): string {
  return text.replace(/\]\(([^)\s]+)\)/g, (link, target: string) => {
    if (/^[a-z]+:/i.test(target)) return link;
    const file = files.find((f) => f.name === path.basename(decodeURIComponent(target)));
    return file ? `](${pathToFileURL(file.path).href})` : link;
  });
}

function defaultText(state: string): string {
  if (state === "completed") return "Done.";
  if (state === "needs_input") return "I need a detail from you to carry on.";
  if (state === "canceled") return "Stopped.";
  return "The computer couldn't finish this.";
}

const ignoreMissing = (error: unknown) => {
  // No task before the session's first run.
  if (error instanceof ApiError && error.status === 404) return undefined;
  throw error;
};

/** " · example.com" for a step's page, so the person sees where each step went. */
export function site(url: string | undefined): string {
  if (!url) return "";
  try {
    return ` · ${new URL(url).hostname.replace(/^www\./, "")}`;
  } catch {
    return "";
  }
}

/** The agent reading its own skills before it starts: how it works, not what it does for the person. */
function internal(a: AgentActivity): boolean {
  return a.title.includes("[Pine]/") || !!a.facts?.files?.length && a.facts.files.every((f) => f.path.startsWith("[Pine]/"));
}

/** The agent's public steps for this task, from the cursor on, until told to stop. */
async function follow(session: Session, taskId: string, cursor: number | undefined, on: Listener, stop: AbortSignal): Promise<void> {
  let last = cursor === undefined ? undefined : String(cursor);
  while (!stop.aborted) {
    try {
      for await (const event of session.agent.events({ lastEventId: last, expectedTaskId: taskId, frames: false, signal: stop })) {
        last = String(event.eventId);
        const activity = event.activity();
        if (activity && !internal(activity)) on.activity(activity);
        const progress = event.progress();
        if (progress?.text) on.progress(progress.text);
      }
    } catch (error) {
      if (stop.aborted) return;
      log("events:", (error as Error).message);
    }
    if (!stop.aborted) await sleep(1_000);
  }
}

/** Local files the person attached, copied into the session's workspace. */
async function upload(session: Session, files: string[], on: Listener): Promise<string[]> {
  const done: string[] = [];
  for (const file of files) {
    const name = `inputs/${path.basename(file)}`;
    on.step(`Uploading ${path.basename(file)}`);
    await session.writeFile(name, await readFile(file));
    done.push(name);
  }
  return done;
}

/** The files a finished job returned, copied next to the thread: the app's working folder, or ours. */
async function collect(session: Session, turn: AgentTurn, thread: ThreadRecord): Promise<SavedFile[]> {
  const dir = thread.cwd ? path.join(thread.cwd, "pine-computer-files") : own("files", safe(thread.id));
  const saved: SavedFile[] = [];
  for (const artifact of turn.result?.artifacts ?? []) {
    try {
      const bytes = await session.readFile(artifact.relativePath);
      await mkdir(dir, { recursive: true });
      const name = path.basename(artifact.relativePath);
      const target = path.join(dir, name);
      await writeFile(target, bytes);
      saved.push({ path: target, name, size: bytes.byteLength });
    } catch (error) {
      log("couldn't copy", artifact.relativePath, error);
    }
  }
  return saved;
}
