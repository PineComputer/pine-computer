// Pine Computer as MCP tools, for agents that keep their own model and logic (Claude Code, Codex, Cursor,
// a chat app's bots) and hand the computer work to a Computer. A job runs in this process while the tool
// waits a while for it; one that takes longer keeps running, and computer_wait picks it up. A job that
// stops on a question is answered by passing its thread back to computer_task. The same tools serve stdio
// (an agent on this machine) and Streamable HTTP (`pine-computer serve`, where files come back as links).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { log } from "../core/home.js";
import { newThread, readThread, saveThread, type ThreadRecord } from "../core/thread.js";
import { fileLines, jobOf, report, running, start, type Where } from "../jobs.js";
import { ensureViewer, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
const VERSION = "0.1.0";

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
        const busy = jobOf(id);
        if (running(busy)) return text(`This thread's job is still running. Call computer_wait, or computer_cancel first.\n\nthread: ${id}`);
      } else {
        thread = newThread(COMPUTER, where.cwd);
        thread.title = task.split("\n")[0].slice(0, 60);
        await saveThread(thread);
      }
      const job = start(thread, task, (files as string[] | undefined) ?? []);
      return text(await report(job, wait_seconds ?? 240, { where, progress: progress(extra) }));
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
      const job = jobOf(id);
      if (job) return text(await report(job, wait_seconds ?? 240, { where, progress: progress(extra) }));
      const thread = await readThread(id);
      const last = thread?.history.at(-1);
      if (!last) return text(`No job on thread ${id} in this session.`);
      return text(`thread: ${id}\nstate: ${last.state}\n\n${last.reply}${last.files.length ? `\n\nFiles:\n${(await fileLines(id, last.files, where)).join("\n")}` : ""}`);
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
      const job = jobOf(id);
      if (!running(job)) return text(`Nothing is running on thread ${id}.`);
      job.controller.abort();
      return text(await report(job, 30, { where }));
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
