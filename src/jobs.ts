// The jobs this process has handed to a Computer, and how one reports. Every tool-shaped way in uses this
// (the MCP tools, the DeepSeek Harness plugin), so an agent that has used either reads the same thing. A job
// runs here while a tool call waits a while for it; one that takes longer keeps running, and the next wait
// picks it up.

import path from "node:path";
import { readThread, resume, work, type Outcome, type ThreadRecord, type WorkOptions } from "./core/thread.js";
import { fileUrl, hostedLinks, viewerUrl } from "./viewer/server.js";

export interface Job {
  thread: ThreadRecord;
  done: Promise<Outcome>;
  outcome?: Outcome;
  error?: string;
  steps: string[];
  controller: AbortController;
  /** Who hears each step: the tool call that's waiting, if it asked for progress. */
  listener?: (step: string) => void;
}

/** Where the client finds a job's files: on this machine's disk, or at a link the serve process hosts. */
export interface Where {
  /** The working folder new threads keep their files in; none for a hosted client. */
  cwd?: string;
  hosted: boolean;
}

// Kept by the module, not by one server or one mount of a plugin: a job that is running when its caller
// reconnects or reloads must still be found by the next wait.
const jobs = new Map<string, Job>();

export const jobOf = (threadId: string) => jobs.get(threadId);
export const running = (job: Job | undefined): job is Job => !!job && !job.outcome && !job.error;

/**
 * The thread's job: the one this process holds, or the one another process started and left in flight
 * (it restarted, or the caller reached a different one), which this one then follows to its end.
 */
export async function jobFor(threadId: string): Promise<Job | undefined> {
  const held = jobOf(threadId);
  if (held) return held;
  const thread = await readThread(threadId);
  return thread?.job ? follow(thread, (options) => resume(thread, options) as Promise<Outcome>) : undefined;
}

export function start(thread: ThreadRecord, task: string, files: string[]): Job {
  return follow(thread, (options) => work(thread, task, { files, ...options }));
}

function follow(thread: ThreadRecord, run: (options: Pick<WorkOptions, "on" | "signal">) => Promise<Outcome>): Job {
  const controller = new AbortController();
  const job: Job = { thread, steps: [], controller, done: Promise.resolve() as unknown as Promise<Outcome> };
  const note = (text: string) => {
    job.steps.push(text);
    job.listener?.(text);
  };
  job.done = run({
    signal: controller.signal,
    on: {
      step: note,
      activity: (a) => a.state !== "running" && note(`${a.state === "completed" ? "" : `(${a.state}) `}${a.title}`),
      progress: () => {},
    },
  });
  job.done.then(
    (outcome) => (job.outcome = outcome),
    (error: Error) => (job.error = error.message),
  );
  jobs.set(thread.id, job);
  return job;
}

/** Resolves when the signal fires. The listener is removed when `settled` does, so a long job leaks none. */
function aborted(signal: AbortSignal, settled: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    void settled.finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export interface ReportOptions {
  where?: Where;
  /** Hears each step while this call waits. */
  progress?: (step: string) => void;
  /** The caller giving up: the wait ends and this throws. The job itself keeps running. */
  signal?: AbortSignal;
}

/** Waits for the job up to the limit, or until the caller gives up, then says where it stands. */
export async function report(job: Job, seconds: number, { where = { hosted: false }, progress, signal }: ReportOptions = {}): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, seconds * 1000)));
  const settled = job.done.catch(() => undefined);
  job.listener = progress;
  try {
    await Promise.race([settled, limit, ...(signal ? [aborted(signal, Promise.race([settled, limit]))] : [])]);
  } finally {
    clearTimeout(timer);
    job.listener = undefined;
  }
  signal?.throwIfAborted();
  const link = await viewerUrl(job.thread.computer, job.thread.session);
  const lines = [`thread: ${job.thread.id}`];
  if (job.error) {
    lines.push("state: error", `The computer couldn't take this on: ${job.error}`);
  } else if (!job.outcome) {
    lines.push("state: working", `Still working. Call computer_wait with this thread to keep waiting. The person can watch it here: ${link}`);
    if (job.steps.length) lines.push("", "Steps so far:", ...job.steps.slice(-10).map((s) => `- ${s}`));
  } else {
    const o = job.outcome;
    lines.push(`state: ${o.state}`, "", where.hosted ? await hostedLinks(o.text, job.thread.id, o.files) : o.text);
    if (o.state === "needs_input") lines.push("", "The computer is waiting. Pass the answer to computer_task with this thread.", `If it needs the person at the screen (a code, a check), they can take over here: ${link}`);
    if (o.files.length) lines.push("", "Files:", ...(await fileLines(job.thread.id, o.files.map((f) => f.path), where)));
    if (o.cost !== null) lines.push("", `cost: $${o.cost.toFixed(2)}`);
  }
  return lines.join("\n");
}

export async function fileLines(threadId: string, paths: string[], where: Where): Promise<string[]> {
  if (!where.hosted) return paths.map((p) => `- ${p}`);
  return Promise.all(paths.map(async (p) => `- ${path.basename(p)}: ${await fileUrl(threadId, path.basename(p))}`));
}
