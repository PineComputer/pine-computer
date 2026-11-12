// Pine Computer as tools of a DeepSeek Harness agent. The agent keeps its own model and logic and hands
// the computer work to a Computer, through the same four tools the MCP server offers (src/mcp/server.ts),
// with the same descriptions and the same reports. Here they are registered on dsh's own tool registry, so
// they come with the plugin: installed with `dsh plugin add`, switched on and off on the Plugins page, and
// set up like any other plugin's row.

import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { HarnessError } from "@deepseek-ai/dsh-error";
import { ToolArgsError, defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { loadEnv } from "../../../src/core/home.js";
import { newThread, readThread, saveThread, type ThreadRecord } from "../../../src/core/thread.js";
import { ensureViewer, viewerUrl } from "../../../src/viewer/server.js";
import { jobOf, report, running, start } from "../../../src/jobs.js";

export const name = "pine-computer";
export const inject = ["tools", "credentials"];

export interface Config {
  /** The name of the stored credential (or environment variable) that holds the Pine project key. */
  apiKeyEnv: string;
  /** The Pine endpoint, when it isn't the one the SDK uses by default. */
  endpoint?: string;
  /** Which of this install's Computers the agent gets. Each keeps its own sign-ins. */
  computer?: string;
  /** How long a tool call waits for a job when the agent doesn't say. The job keeps running after. */
  waitSeconds: number;
}

export const Config: z<Config> = z.object({
  // A reference, not the key: dsh's credential store holds the value, so no secret is written to a profile.
  apiKeyEnv: z.string().role("credential-ref").default("PINE_SANDBOX_API_KEY"),
  endpoint: z.string(),
  computer: z.string(),
  waitSeconds: z.number().step(1).min(5).max(600).default(240),
});

/** Something the person has to set up before a Computer can take a job. */
class PineComputerSetupError extends HarnessError {
  constructor(message: string) {
    super(message, "PINE_COMPUTER_SETUP");
  }
}

const text = { schema: { type: "string" }, render: (_args: unknown, value: string) => [{ type: "text" as const, text: value }] } as const;

export function apply(ctx: Context, config: Config): void {
  const computer = config.computer || process.env.PINE_COMPUTER || "default";

  // The core reads the key and the endpoint from the environment (as the Pine SDK does), and the desktop
  // page's process inherits them from there. So the value dsh holds is copied in before each job: from its
  // credential store first, which also covers the environment dsh was started in, then from
  // ~/.pine-computer/env, where the CLI keeps it.
  async function setUp(): Promise<void> {
    const stored = await ctx.credentials.resolve(credentialRef(config.apiKeyEnv));
    if (stored) process.env.PINE_SANDBOX_API_KEY = stored.value;
    else loadEnv();
    if (config.endpoint) process.env.PINE_SANDBOX_ENDPOINT = config.endpoint;
    if (!process.env.PINE_SANDBOX_API_KEY) {
      throw new PineComputerSetupError(`Pine Computer has no project key. Ask the person to store one as ${config.apiKeyEnv} in DeepSeek Harness (or to start dsh with it in the environment), then try again.`);
    }
    await ensureViewer().catch((error: Error) => ctx.logger.warn(`pine-computer: the desktop page didn't start: ${error.message}`));
  }

  function seconds(given: number | undefined): number {
    const value = given ?? config.waitSeconds;
    if (!Number.isInteger(value) || value < 5 || value > 600) throw new ToolArgsError(["wait_seconds must be a whole number from 5 to 600"]);
    return value;
  }

  ctx.tools.register(defineTool({
    name: "computer_task",
    description:
      "Hand a job to a Pine Computer: a whole cloud computer with a browser, a desktop, files, and document and media tools, that stays signed in to the sites it has used. It works on its own and reports back with a summary and any files it made. Use it for work on websites and documents: do something on a site (sign in, fill in and submit forms, buy, book, cancel), research across pages, collect data, and make or edit files (PDF, Word, Excel, PowerPoint). Describe the outcome you want, not the clicks. It may stop with a question: answer it by calling this tool again with the same thread. Pass the thread to follow up on earlier work too: the computer remembers the thread.",
    parameters: {
      task: { type: "string", required: true, description: "What to do, or the answer to the computer's question. Name the site and the result you want." },
      thread: { type: "string", description: "The thread of an earlier job, to answer its question or follow up. Leave out to start a new thread." },
      files: { type: "array", items: { type: "string" }, description: "Absolute paths of local files the job needs; they're uploaded to the computer." },
      wait_seconds: { type: "integer", description: "How long to wait for the job before returning (default 240). It keeps running after." },
    },
    output: text,
    async execute(args, exec) {
      if (!args.task.trim()) throw new ToolArgsError(["task must not be empty"]);
      const wait = seconds(args.wait_seconds);
      let thread: ThreadRecord | undefined;
      if (args.thread) {
        thread = await readThread(args.thread);
        if (!thread) return `No thread ${args.thread}. Leave the thread out to start a new one.`;
        if (running(jobOf(args.thread))) return `This thread's job is still running. Call computer_wait, or computer_cancel first.\n\nthread: ${args.thread}`;
      }
      await setUp();
      if (!thread) {
        // Files a job makes are copied next to the work the agent is doing: the session's folder.
        thread = newThread(computer, exec.agent?.session.header.cwd);
        thread.title = args.task.split("\n")[0].slice(0, 60);
        await saveThread(thread);
      }
      const job = start(thread, args.task, args.files ?? []);
      try {
        return await report(job, wait, { signal: exec.signal });
      } catch (error) {
        // The call was stopped before the agent heard which thread this is, so it couldn't cancel the job
        // itself: stop it here rather than leave a Computer working for nobody.
        if (exec.signal.aborted) job.controller.abort();
        throw error;
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "computer_wait",
    description: "Keep waiting for a job that computer_task left running, and get its result.",
    parameters: {
      thread: { type: "string", required: true, description: "The job's thread." },
      wait_seconds: { type: "integer", description: "How long to wait (default 240)." },
    },
    output: text,
    async execute(args, exec) {
      const wait = seconds(args.wait_seconds);
      const job = jobOf(args.thread);
      // Stopping this call only stops the waiting: the agent knows the thread and can cancel the job.
      if (job) return report(job, wait, { signal: exec.signal });
      const thread = await readThread(args.thread);
      const last = thread?.history.at(-1);
      if (!last) return `No job on thread ${args.thread} in this session.`;
      return `thread: ${args.thread}\nstate: ${last.state}\n\n${last.reply}${last.files.length ? `\n\nFiles:\n${last.files.map((f) => `- ${f}`).join("\n")}` : ""}`;
    },
  }));

  ctx.tools.register(defineTool({
    name: "computer_cancel",
    description: "Stop the job running on a thread. The thread stays open for the next task.",
    parameters: { thread: { type: "string", required: true } },
    output: text,
    async execute(args, exec) {
      const job = jobOf(args.thread);
      if (!running(job)) return `Nothing is running on thread ${args.thread}.`;
      job.controller.abort();
      return report(job, 30, { signal: exec.signal });
    },
  }));

  ctx.tools.register(defineTool({
    name: "computer_desktop",
    description: "A link for the person to watch a thread's computer live, and to take the controls (to enter a code, pass a check, or show it how) and hand them back.",
    parameters: { thread: { type: "string", required: true } },
    output: text,
    async execute(args) {
      const thread = await readThread(args.thread);
      if (!thread) return `No thread ${args.thread}.`;
      return viewerUrl(thread.computer, thread.session);
    },
  }));
}
