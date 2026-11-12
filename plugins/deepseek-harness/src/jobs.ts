// The jobs this process has handed to a Computer, and how one reports. This is the same bookkeeping as
// src/mcp/server.ts, without the MCP types: a job runs here while a tool call waits a while for it, one
// that takes longer keeps running, and computer_wait picks it up. The wording of every report is kept the
// same as the MCP tools', so the shared skill and an agent that has used either read the same thing.

import { work, type Outcome, type ThreadRecord } from "../../../src/core/thread.js";
import { viewerUrl } from "../../../src/viewer/server.js";

export interface Job {
  thread: ThreadRecord;
  done: Promise<Outcome>;
  outcome?: Outcome;
  error?: string;
  steps: string[];
  controller: AbortController;
}

// Kept by the module, not by one mount of the plugin: dsh mounts the plugin again when its settings
// change, and a job that is running then must still be found by the next computer_wait.
const jobs = new Map<string, Job>();

export const jobOf = (threadId: string) => jobs.get(threadId);
export const running = (job: Job | undefined): job is Job => !!job && !job.outcome && !job.error;

export function start(thread: ThreadRecord, task: string, files: string[]): Job {
  const controller = new AbortController();
  const job: Job = { thread, steps: [], controller, done: Promise.resolve() as unknown as Promise<Outcome> };
  const note = (text: string) => void job.steps.push(text);
  job.done = work(thread, task, {
    files,
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

/** Waits for the job up to the limit, or until the caller gives up, then says where it stands. */
export async function report(job: Job, seconds: number, signal?: AbortSignal): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, seconds * 1000)));
  const settled = job.done.catch(() => undefined);
  try {
    await Promise.race([settled, limit, ...(signal ? [aborted(signal, Promise.race([settled, limit]))] : [])]);
  } finally {
    clearTimeout(timer);
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
    lines.push(`state: ${o.state}`, "", o.text);
    if (o.state === "needs_input") lines.push("", "The computer is waiting. Pass the answer to computer_task with this thread.", `If it needs the person at the screen (a code, a check), they can take over here: ${link}`);
    if (o.files.length) lines.push("", "Files:", ...o.files.map((f) => `- ${f.path}`));
    if (o.cost !== null) lines.push("", `cost: $${o.cost.toFixed(2)}`);
  }
  return lines.join("\n");
}
