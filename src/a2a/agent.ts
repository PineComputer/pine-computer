// Pine Computer as an A2A agent, for agent platforms that delegate work to remote agents. A context is a
// thread with its own session on the Computer. A task is one job, across the questions it stops on: each
// finished step streams as a working status, a question ends in input-required and a message on the same
// task answers it, and the summary and the files come back as artifacts. Served by `pine-computer serve`.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentActivity } from "@pinesandbox/computer";
import { A2A_PROTOCOL_VERSION, Role, TaskState, type AgentCard, type Message, type Part } from "@a2a-js/sdk";
import { AgentEvent, type AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { at, log, safe } from "../core/home.js";
import { dropQuestion, newThread, readThread, saveThread, site, work, type SavedFile, type ThreadRecord } from "../core/thread.js";
import { fileUrl, hostedLinks, mediaType, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
const VERSION = "0.1.0";
/** Files up to this size come back inline; larger ones as a link. */
const INLINE_BYTES = 10 * 1024 * 1024;

export function agentCard(origin: string): AgentCard {
  return {
    name: "Pine Computer",
    description:
      "A whole cloud computer with a browser, a desktop, files, and document and media tools, that stays signed in to the sites it has used. Hand it a job in words: it works on its own, streams its steps, asks when it needs something only the person has or before it spends, sends or submits, and returns a summary and the files it made. The person can watch the computer and take the controls at any point.",
    // One endpoint for both: clients still on A2A 0.3 (most platforms today) and 1.0 ones.
    supportedInterfaces: [
      { url: `${origin}/a2a`, protocolBinding: "JSONRPC", tenant: "", protocolVersion: A2A_PROTOCOL_VERSION },
      { url: `${origin}/a2a`, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "0.3" },
    ],
    provider: { organization: "Pine Computer", url: "https://pinecomputer.io" },
    version: VERSION,
    capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {
      bearer: { scheme: { $case: "httpAuthSecurityScheme", value: { description: "The serve process's token.", scheme: "Bearer", bearerFormat: "" } } },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text/plain", "application/octet-stream"],
    defaultOutputModes: ["text/plain", "application/pdf", "application/octet-stream"],
    skills: [
      {
        id: "web-tasks",
        name: "Work on websites",
        description: "Sign in, fill in and submit forms, buy, book and cancel, on any site, and stay signed in for next time.",
        tags: ["browser", "forms", "sign-in"],
        examples: ["Fill in the order form on https://httpbin.org/forms/post for a large pizza, and ask me before you submit it."],
        inputModes: [],
        outputModes: [],
        securityRequirements: [],
      },
      {
        id: "research",
        name: "Research and collect",
        description: "Read across pages and sites, collect what it finds, and report it with its sources.",
        tags: ["research", "data"],
        examples: ["Open https://news.ycombinator.com and tell me the top 3 stories."],
        inputModes: [],
        outputModes: [],
        securityRequirements: [],
      },
      {
        id: "documents",
        name: "Make documents",
        description: "Make and edit files (PDF, Word, Excel, PowerPoint, images) and return them.",
        tags: ["pdf", "documents", "files"],
        examples: ["Make a one-page PDF brief of the top five Hacker News stories."],
        inputModes: [],
        outputModes: [],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };
}

const textPart = (text: string): Part => ({ content: { $case: "text", value: text }, mediaType: "text/plain", filename: "", metadata: undefined });

export class PineExecutor implements AgentExecutor {
  /** Jobs running now, by task. */
  private running = new Map<string, { thread: string; controller: AbortController }>();
  /** Tasks whose job stopped on a question, by task. */
  private waiting = new Map<string, { thread: ThreadRecord; contextId: string }>();

  execute = async (ctx: RequestContext, bus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = ctx;
    const thread = await threadFor(contextId);
    const say = (state: TaskState, text: string, metadata?: Record<string, unknown>) =>
      bus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: { state, message: message(taskId, contextId, text, metadata), timestamp: new Date().toISOString() }, metadata: {} }));

    bus.publish(AgentEvent.task(ctx.task ?? { id: taskId, contextId, status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() }, artifacts: [], history: [ctx.userMessage], metadata: {} }));
    if ([...this.running.values()].some((r) => r.thread === thread.id)) {
      return say(TaskState.TASK_STATE_REJECTED, "This conversation already has a job running. Wait for it, or cancel it first.");
    }
    const controller = new AbortController();
    this.running.set(taskId, { thread: thread.id, controller });
    this.waiting.delete(taskId);

    try {
      const { text, files } = await read(ctx.userMessage, thread);
      if (!thread.title) {
        thread.title = text.split("\n")[0].slice(0, 60) || "Task";
        await saveThread(thread);
      }
      const desktop = await viewerUrl(COMPUTER, thread.session);
      say(TaskState.TASK_STATE_WORKING, ctx.task ? "Carrying on." : `On it. Watch the computer or take over: ${desktop}`, { desktop });

      const outcome = await work(thread, text, {
        files,
        // A new task starts its own job; a message on a waiting task answers its question.
        newJob: !ctx.task,
        signal: controller.signal,
        on: {
          step: (t) => say(TaskState.TASK_STATE_WORKING, t),
          activity: (a: AgentActivity) => {
            if (a.state === "running") return;
            const page = a.facts?.page;
            say(TaskState.TASK_STATE_WORKING, `${a.state === "completed" ? "" : `(${a.state}) `}${a.title}${site(page?.url)}`, {
              step: { id: a.id, kind: a.kind, state: a.state, ...(page ? { page } : {}) },
            });
          },
          progress: () => {},
        },
      });

      const reply = await hostedLinks(outcome.text, thread.id, outcome.files);
      if (outcome.state === "completed") {
        for (const f of outcome.files) bus.publish(artifact(taskId, contextId, f.name, "A file the job made.", [await filePart(thread, f)]));
        bus.publish(artifact(taskId, contextId, "summary", "What the computer did and found.", [textPart(reply)]));
        say(TaskState.TASK_STATE_COMPLETED, reply, outcome.cost !== null ? { cost: outcome.cost } : undefined);
      } else if (outcome.state === "needs_input") {
        this.waiting.set(taskId, { thread, contextId });
        say(TaskState.TASK_STATE_INPUT_REQUIRED, `${reply}\n\nIf it needs the person at the screen (a code, a check), they can take over here: ${desktop}`, { desktop });
      } else if (outcome.state === "canceled") {
        say(TaskState.TASK_STATE_CANCELED, reply);
      } else {
        say(TaskState.TASK_STATE_FAILED, `The computer couldn't finish: ${reply}`);
      }
    } catch (error) {
      if (controller.signal.aborted) return say(TaskState.TASK_STATE_CANCELED, "Stopped.");
      log("a2a task failed:", error);
      say(TaskState.TASK_STATE_FAILED, `The computer couldn't take this on: ${(error as Error).message}`);
    } finally {
      this.running.delete(taskId);
    }
  };

  cancelTask = async (taskId: string, bus: ExecutionEventBus): Promise<void> => {
    const job = this.running.get(taskId);
    // The job ends as canceled, and its execute says so.
    if (job) return void job.controller.abort();
    const waiting = this.waiting.get(taskId);
    this.waiting.delete(taskId);
    if (waiting) await dropQuestion(waiting.thread).catch((error) => log("a2a cancel:", error));
    const contextId = waiting?.contextId ?? "";
    bus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: { state: TaskState.TASK_STATE_CANCELED, message: message(taskId, contextId, "Stopped."), timestamp: new Date().toISOString() }, metadata: {} }));
  };
}

/** The context's thread, made on its first message. */
async function threadFor(contextId: string): Promise<ThreadRecord> {
  const id = `a2a-${safe(contextId)}`;
  const saved = await readThread(id);
  if (saved) return saved;
  const thread = { ...newThread(COMPUTER), id };
  await saveThread(thread);
  return thread;
}

function message(taskId: string, contextId: string, text: string, metadata?: Record<string, unknown>): Message {
  return { messageId: randomUUID(), contextId, taskId, role: Role.ROLE_AGENT, parts: [textPart(text)], metadata, extensions: [], referenceTaskIds: [] };
}

function artifact(taskId: string, contextId: string, name: string, description: string, parts: Part[]) {
  return AgentEvent.artifactUpdate({ taskId, contextId, artifact: { artifactId: randomUUID(), name, description, parts, metadata: {}, extensions: [] }, append: false, lastChunk: true, metadata: {} });
}

async function filePart(thread: ThreadRecord, f: SavedFile): Promise<Part> {
  const type = mediaType(f.name).split(";")[0];
  if (f.size <= INLINE_BYTES) return { content: { $case: "raw", value: await readFile(f.path) }, mediaType: type, filename: f.name, metadata: undefined };
  return { content: { $case: "url", value: await fileUrl(thread.id, f.name) }, mediaType: type, filename: f.name, metadata: undefined };
}

/** The message as the job's words, with the files it carries saved for upload. */
async function read(m: Message, thread: ThreadRecord): Promise<{ text: string; files: string[] }> {
  const text: string[] = [];
  const files: string[] = [];
  for (const [i, p] of m.parts.entries()) {
    const c = p.content;
    if (c?.$case === "text") text.push(c.value);
    else if (c?.$case === "data") text.push(JSON.stringify(c.value, null, 2));
    else if (c?.$case === "url") text.push(`(${p.filename || "file"}: ${c.value})`);
    else if (c?.$case === "raw") {
      const dir = at("inputs", safe(thread.id));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, safe(p.filename || `file-${i + 1}`));
      await writeFile(file, c.value, { mode: 0o600 });
      files.push(file);
    }
  }
  return { text: text.join("\n").trim(), files };
}
