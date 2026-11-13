// A message in a thread is a job for its coworker. This is the path from the message
// to Pine's agent: record it, bring the coworker's Computer up if it must, open the
// thread's session, and hand the agent the goal with the coworker's role and brief as
// context. Replies, steering, stopping and "save as a skill" act on the job's turn.
//
// Starting a Computer takes a while, so a job is recorded first and launched in the
// background; the page follows its state. A job that can't start yet (the project's
// limit on running Computers, or every session busy) waits in the queue, and the
// worker launches it when there's room.

import "server-only";
import { randomBytes } from "node:crypto";
import { APPROVAL_MARK } from "@/shared/api";
import { explain, HttpError } from "./http";
import { computer, ensureComputer, ensureSession, requireSession, Waiting } from "./pine";
import { read, update, type CoworkerRecord, type JobRecord, type StoreData } from "./store";
import { secretValues } from "./vault";

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
/** A thread with one of these can't take a new job: steer it, answer it or stop it. */
const BUSY = new Set(["queued", "starting", "running", "canceling", "needs_input"]);

/** What every job carries besides its goal: who the coworker is, and the house rules. */
export function context(coworker: Pick<CoworkerRecord, "name" | "role" | "brief">, earlier: Pick<JobRecord, "ask" | "summary">[] = []): string {
  const lines = [
    `You are ${coworker.name}, the ${coworker.role.toLowerCase()} on this team. ${coworker.brief}`,
    "",
    "House rules:",
    `- Before you spend money, send a message, or submit a form or anything else that can't be undone, stop and ask. Begin that question with the line "${APPROVAL_MARK}" and say exactly what you are about to do.`,
    "- When you make a document, save it in the work directory and return it as a file.",
    "- Answer in short, plain prose.",
  ];
  if (earlier.length) {
    // A session that was just opened remembers nothing: say what the thread already covered.
    lines.push("", "Earlier in this thread, in a session that has since ended (its files are gone):");
    for (const job of earlier.slice(-3)) lines.push(`- Asked: ${clip(job.ask, 400)}`, `  You answered: ${clip(job.summary ?? "", 1200)}`);
  }
  return lines.join("\n");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** A thread's name in the sidebar, from its first message. */
export const titleOf = (goal: string) => clip(goal.replace(/https?:\/\/(www\.)?/g, "").replace(/\s+/g, " ").trim(), 56);

/** Opens a new thread with a coworker and gives it its first job. */
export async function openThread(coworker: string, goal: string, key: string): Promise<string> {
  const id = `t-${randomBytes(4).toString("hex")}`;
  await update((data) => {
    if (!data.coworkers.some((c) => c.id === coworker)) throw new HttpError(404, "That coworker isn't in this workspace.");
    data.threads.push({ id, coworker, title: titleOf(goal), createdAt: new Date().toISOString() });
  });
  await submit(id, goal, key);
  return id;
}

/** Records a message as a job and launches it. The same key again changes nothing. */
export async function submit(thread: string, goal: string, key: string): Promise<void> {
  if (!KEY.test(key)) throw new HttpError(400, "Send the message's key.");
  const fresh = await update((data) => {
    if (data.jobs.some((j) => j.id === key)) return false;
    const found = data.threads.find((t) => t.id === thread);
    if (!found) throw new HttpError(404, "That thread isn't in this workspace.");
    if (data.jobs.some((j) => j.thread === thread && BUSY.has(j.state))) throw new HttpError(409, "It is still on the last job in this thread.");
    data.jobs.push({ id: key, thread, coworker: found.coworker, kind: "run", ask: goal, askedAt: new Date().toISOString(), state: "starting" });
    return true;
  });
  if (fresh) launch(key);
}

// One launch per job at a time, whether a route or the worker asks.
const shared = globalThis as typeof globalThis & { __launching?: Set<string> };
const launching = (shared.__launching ??= new Set());

/** Starts a recorded job on its coworker's Computer, in the background. */
export function launch(job: string): void {
  if (launching.has(job)) return;
  launching.add(job);
  void start(job)
    .catch((error) => console.error("launch:", error))
    .finally(() => launching.delete(job));
}

const waitingToStart = (data: StoreData, id: string) => data.jobs.find((j) => j.id === id && (j.state === "starting" || j.state === "queued"));

async function start(id: string): Promise<void> {
  const job = waitingToStart(await read(), id);
  if (!job) return;
  try {
    const found = await ensureComputer(job.coworker);
    const { session, fresh } = await ensureSession(found, job.thread);
    const data = await read();
    if (!waitingToStart(data, id)) return; // stopped while its Computer started
    const coworker = data.coworkers.find((c) => c.id === job.coworker)!;
    const earlier = fresh ? data.jobs.filter((j) => j.thread === job.thread && j.id !== id && j.summary && j.state === "completed") : [];
    // The job's key names the submission: sent again (after a lost response, or by the
    // worker after a restart) it returns the turn it started instead of starting another.
    const turn = await session.agent.run(job.ask, { idempotencyKey: id, context: context(coworker, earlier), secrets: await secretValues() });
    await update((next) => {
      const record = next.jobs.find((j) => j.id === id);
      if (record) Object.assign(record, { turnId: turn.turnId, state: turn.state, waiting: undefined });
    });
  } catch (error) {
    const waiting = error instanceof Waiting ? error.message : null;
    const said = waiting ?? explain(error).error;
    await update((next) => {
      const record = waitingToStart(next, id);
      if (!record) return;
      if (waiting) Object.assign(record, { state: "queued", waiting });
      else Object.assign(record, { state: "failed", summary: said, endedAt: new Date().toISOString(), items: [], files: [] });
    });
  }
}

async function jobIn(thread: string, id: string): Promise<JobRecord> {
  const job = (await read()).jobs.find((j) => j.id === id && j.thread === thread);
  if (!job) throw new HttpError(404, "That job isn't in this thread.");
  return job;
}

/** Answers the question a job ended on. The reply opens the next turn, which carries the same job on. */
export async function answer(thread: string, id: string, text: string): Promise<void> {
  const job = await jobIn(thread, id);
  if (!job.turnId || job.state !== "needs_input") throw new HttpError(409, "That question has moved on.");
  const agent = (await requireSession(thread)).agent;
  // The same answer again returns the same new turn.
  const opened = await agent.answer(job.turnId, text, { secrets: await secretValues() });
  await update((data) => {
    const asked = data.jobs.find((j) => j.id === id);
    if (asked) asked.state = "answered";
    if (data.jobs.some((j) => j.id === opened.turnId)) return;
    data.jobs.push({ id: opened.turnId, thread, coworker: job.coworker, kind: "answer", ask: text, askedAt: new Date().toISOString(), turnId: opened.turnId, state: opened.state });
  });
}

/** Adds guidance to a job while it runs. */
export async function steer(thread: string, id: string, text: string): Promise<void> {
  const job = await jobIn(thread, id);
  if (!job.turnId) throw new HttpError(409, "It hasn't started yet. Stop it and send the job again instead.");
  await (await requireSession(thread)).agent.steer(job.turnId, text, { secrets: await secretValues() });
}

/** Stops a job: one still waiting is dropped, one running is canceled, a question is closed. */
export async function cancel(thread: string, id: string): Promise<void> {
  const job = await jobIn(thread, id);
  if (!job.turnId) {
    await update((data) => {
      const record = waitingToStart(data, id);
      if (record) Object.assign(record, { state: "canceled", waiting: undefined, endedAt: new Date().toISOString(), items: [], files: [] });
    });
    return;
  }
  const turn = await (await requireSession(thread)).agent.cancel(job.turnId);
  await update((data) => {
    const record = data.jobs.find((j) => j.id === id);
    if (record && !record.files) record.state = turn.state;
  });
}

// ---- teach it ---------------------------------------------------------------------

/**
 * Drafts a skill from the thread's last finished job. Authoring runs on its own model
 * for a minute or three, so it runs in the background and the draft is noted on the
 * job; it reaches no agent until a person reads and activates it.
 */
export async function learn(thread: string, id: string): Promise<void> {
  const job = await jobIn(thread, id);
  if (job.state !== "completed") throw new HttpError(409, "Only a finished job can be saved as a skill.");
  const session = await requireSession(thread);
  const note = (learned: JobRecord["learn"]) =>
    update((data) => {
      const record = data.jobs.find((j) => j.id === id);
      if (record) record.learn = learned;
    });
  const startedAt = new Date().toISOString();
  await note({ state: "drafting", startedAt });
  void session
    .learn()
    .then((result) => {
      const draft = result.draft as { name?: string; version?: number } | undefined;
      return result.learned && draft?.name
        ? note({ state: "draft", name: draft.name, version: Number(draft.version), startedAt })
        : note({ state: "none", reason: result.reason || "Nothing in this job was worth keeping as a skill.", startedAt });
    })
    .catch((error) => note({ state: "none", reason: explain(error).error, startedAt }));
}

/** A coworker's learned skills, read from its Computer and kept for when it's stopped. */
export async function refreshSkills(coworker: string): Promise<void> {
  const found = await computer(coworker);
  if (!found) return;
  const skills = (await found.skills.list())
    .filter((s) => s.origin === "learned" && s.hidden !== true)
    .map((s) => ({ name: String(s.name), description: String(s.description ?? "") }));
  await update((data) => {
    const record = data.coworkers.find((c) => c.id === coworker);
    if (record && JSON.stringify(record.skills) !== JSON.stringify(skills)) record.skills = skills;
  });
}

/** Activates a draft a person has read, or discards it. */
export async function decideDraft(coworker: string, name: string, version: number, decision: "activate" | "discard"): Promise<void> {
  const found = await computer(coworker);
  if (!found) throw new HttpError(409, "Its Computer is stopped. Start it to review the draft.");
  if (decision === "activate") await found.skills.activate(name, version);
  else await found.skills.deleteVersion(name, version);
  await update((data) => {
    for (const job of data.jobs) {
      if (job.coworker !== coworker || job.learn?.name !== name || job.learn.version !== version) continue;
      if (decision === "activate") job.learn.state = "active";
      else delete job.learn;
    }
  });
  await refreshSkills(coworker);
}
