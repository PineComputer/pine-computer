// Pine Computer as MCP tools, for agents that keep their own model and logic (Claude Code, Codex, Cursor,
// a chat app's bots) and hand the computer work to a Computer. A job runs in this process while the tool
// waits a while for it; one that takes longer keeps running, and computer_wait picks it up. A job that
// stops on a question is answered by passing its thread back to computer_task. The same tools serve stdio
// (an agent on this machine) and Streamable HTTP (`pine-computer serve`, where files come back as links).

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { log } from "../core/home.js";
import { newThread, readThread, saveThread, work, type Outcome, type ThreadRecord } from "../core/thread.js";
import { ensureViewer, fileUrl, hostedLinks, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
const VERSION = "0.1.0";

interface Job {
  thread: ThreadRecord;
  done: Promise<Outcome>;
  outcome?: Outcome;
  error?: string;
  steps: string[];
  controller: AbortController;
  /** Who hears each step: the tool call that's waiting, if it asked for progress. */
  listener?: (step: string) => void;
}

const jobs = new Map<string, Job>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(thread: ThreadRecord, task: string, files: string[]): Job {
  const controller = new AbortController();
  const job: Job = { thread, steps: [], controller, done: Promise.resolve() as unknown as Promise<Outcome> };
  const note = (text: string) => {
    job.steps.push(text);
    job.listener?.(text);
  };
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

/** Where the client finds the tools' files: on this machine's disk, or at a link the serve process hosts. */
interface Where {
  /** The working folder new threads keep their files in; none for a hosted client. */
  cwd?: string;
  hosted: boolean;
}

/** Waits for the job up to the limit, then says where it stands. */
async function report(job: Job, seconds: number, where: Where, progress?: (step: string) => void): Promise<string> {
  job.listener = progress;
  await Promise.race([job.done.catch(() => undefined), sleep(seconds * 1000)]);
  job.listener = undefined;
  const link = await viewerUrl(COMPUTER, job.thread.session);
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
    if (o.files.length) lines.push("", "Files:", ...(await files(job.thread.id, o.files.map((f) => f.path), where)));
    if (o.cost !== null) lines.push("", `cost: $${o.cost.toFixed(2)}`);
  }
  return lines.join("\n");
}

async function files(threadId: string, paths: string[], where: Where): Promise<string[]> {
  if (!where.hosted) return paths.map((p) => `- ${p}`);
  return Promise.all(paths.map(async (p) => `- ${path.basename(p)}: ${await fileUrl(threadId, path.basename(p))}`));
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function serveMcp(): Promise<void> {
  void ensureViewer().catch((error) => log("viewer:", error.message));
  await mcpServer({ cwd: process.cwd(), hosted: false }).connect(new StdioServerTransport());
}

/** The Computer's tools, on a server of their own for each client connection. Jobs are shared by the process. */
export function mcpServer(where: Where): McpServer {
  const server = new McpServer({ name: "pine-computer", version: VERSION });

  server.registerTool(
    "computer_task",
    {
      title: "Hand a job to a cloud computer",
      description:
        "Hand a job to a Pine Computer: a whole cloud computer with a browser, a desktop, files, and document and media tools, that stays signed in to the sites it has used. It works on its own and reports back with a summary and any files it made. Use it for work on websites and documents: do something on a site (sign in, fill in and submit forms, buy, book, cancel), research across pages, collect data, and make or edit files (PDF, Word, Excel, PowerPoint). Describe the outcome you want, not the clicks. It may stop with a question: answer it by calling this tool again with the same thread. Pass the thread to follow up on earlier work too: the computer remembers the thread.",
      inputSchema: {
        task: z.string().min(1).describe("What to do, or the answer to the computer's question. Name the site and the result you want."),
        thread: z.string().optional().describe("The thread of an earlier job, to answer its question or follow up. Leave out to start a new thread."),
        // Paths name files on the client's machine, which a hosted server can't read.
        ...(where.hosted ? {} : { files: z.array(z.string()).optional().describe("Absolute paths of local files the job needs; they're uploaded to the computer.") }),
        wait_seconds: z.number().int().min(5).max(600).optional().describe("How long to wait for the job before returning (default 240). It keeps running after."),
      },
    },
    async ({ task, thread: id, files, wait_seconds }, extra) => {
      let thread: ThreadRecord | undefined;
      if (id) {
        thread = await readThread(id);
        if (!thread) return text(`No thread ${id}. Leave the thread out to start a new one.`);
        const running = jobs.get(id);
        if (running && !running.outcome && !running.error) return text(`This thread's job is still running. Call computer_wait, or computer_cancel first.\n\nthread: ${id}`);
      } else {
        thread = newThread(COMPUTER, where.cwd);
        thread.title = task.split("\n")[0].slice(0, 60);
        await saveThread(thread);
      }
      const job = start(thread, task, (files as string[] | undefined) ?? []);
      return text(await report(job, wait_seconds ?? 240, where, progress(extra)));
    },
  );

  server.registerTool(
    "computer_wait",
    {
      title: "Wait for a computer job",
      description: "Keep waiting for a job that computer_task left running, and get its result.",
      inputSchema: {
        thread: z.string().describe("The job's thread."),
        wait_seconds: z.number().int().min(5).max(600).optional().describe("How long to wait (default 240)."),
      },
    },
    async ({ thread: id, wait_seconds }, extra) => {
      const job = jobs.get(id);
      if (job) return text(await report(job, wait_seconds ?? 240, where, progress(extra)));
      const thread = await readThread(id);
      const last = thread?.history.at(-1);
      if (!last) return text(`No job on thread ${id} in this session.`);
      return text(`thread: ${id}\nstate: ${last.state}\n\n${last.reply}${last.files.length ? `\n\nFiles:\n${(await files(id, last.files, where)).join("\n")}` : ""}`);
    },
  );

  server.registerTool(
    "computer_cancel",
    {
      title: "Cancel a computer job",
      description: "Stop the job running on a thread. The thread stays open for the next task.",
      inputSchema: { thread: z.string() },
    },
    async ({ thread: id }) => {
      const job = jobs.get(id);
      if (!job || job.outcome || job.error) return text(`Nothing is running on thread ${id}.`);
      job.controller.abort();
      return text(await report(job, 30, where));
    },
  );

  server.registerTool(
    "computer_desktop",
    {
      title: "Show the computer's screen",
      description: "A link for the person to watch a thread's computer live, and to take the controls (to enter a code, pass a check, or show it how) and hand them back.",
      inputSchema: { thread: z.string() },
    },
    async ({ thread: id }) => {
      const thread = await readThread(id);
      if (!thread) return text(`No thread ${id}.`);
      return text(await viewerUrl(thread.computer, thread.session));
    },
  );

  return server;
}

type Extra = { _meta?: { progressToken?: string | number }; sendNotification: (n: never) => Promise<void> };

/** Steps as MCP progress, for a client that asked for it. */
function progress(extra: unknown): ((step: string) => void) | undefined {
  const { _meta, sendNotification } = extra as Extra;
  const token = _meta?.progressToken;
  if (token === undefined) return undefined;
  let n = 0;
  return (message) => void sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message } } as never).catch(() => undefined);
}
