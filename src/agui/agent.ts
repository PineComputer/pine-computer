// Pine Computer as an AG-UI agent, for chat apps that add a bot by its address (CopilotKit OpenBot, any
// CopilotKit app, any AG-UI client). An AG-UI thread is a thread with its own session on the Computer. A run
// is one message from the person: it starts a job, or answers the question the last run ended on. The steps
// stream as tool calls, the summary (or the question) is the assistant's message, and the files and the
// desktop come as links. Served by `pine-computer serve`.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentActivity } from "@pinesandbox/computer";
import { EventType, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { Request, RequestHandler, Response } from "express";
import { at, log, safe } from "../core/home.js";
import { newThread, readThread, saveThread, work, type ThreadRecord } from "../core/thread.js";
import { fileUrl, hostedLinks, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
/** How long a run waits before it starts its job, for a client that only came to see whether an agent answers. */
const GRACE_MS = 800;
/** A quiet stream is taken for a dead one (OpenBot ends a turn after 60 s of silence), so a long step says so. */
const KEEPALIVE_MS = 15_000;

/** Threads with a job running now. */
const running = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function aguiHandler(): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const input = req.body as Partial<RunAgentInput> | undefined;
    const message = [...(Array.isArray(input?.messages) ? input.messages : [])].reverse().find((m) => m?.role === "user");
    if (!input || typeof input.threadId !== "string" || !input.threadId || !message) {
      return void res.status(400).json({ error: "An AG-UI run is expected: a threadId, a runId and messages, the last user message being the job." });
    }
    const threadId = input.threadId;
    const runId = typeof input.runId === "string" && input.runId ? input.runId : randomUUID();

    // Server-sent events whatever the client accepts: every AG-UI client reads them.
    const encoder = new EventEncoder();
    res.writeHead(200, { "content-type": encoder.getContentType(), "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
    // A client that leaves stops hearing the job; it doesn't stop it, as with an A2A client that drops its
    // stream. The Computer finishes, the thread keeps the outcome, and the next message carries on from there.
    let gone = false;
    res.on("close", () => (gone = true));
    const emit = (event: Record<string, unknown> & { type: EventType }) => void (gone || res.write(encoder.encodeSSE(event as BaseEvent)));
    const say = (text: string) => {
      const messageId = randomUUID();
      emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
      emit({ type: EventType.TEXT_MESSAGE_END, messageId });
    };

    // Each step is a tool call the Computer has already answered. OpenBot draws a tool call it has no
    // component for as a line, folds a run of them into one row ("Used 4 tools") that opens to each, and
    // words each line from the tool's name alone; it draws nothing for STEP_STARTED, and an activity message
    // only for the kinds it has a renderer for. So the name is the step's title, and the arguments carry the
    // title as written and the step's kind.
    const calls = new Map<string, string>();
    const begin = (key: string, title: string, kind: string) => {
      const toolCallId = randomUUID();
      calls.set(key, toolCallId);
      emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: toolName(title) });
      emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ step: title, kind }) });
      emit({ type: EventType.TOOL_CALL_END, toolCallId });
    };
    const end = (key: string, result: string) => {
      const toolCallId = calls.get(key);
      if (!toolCallId) return;
      calls.delete(key);
      emit({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId, content: result, role: "tool" });
    };

    emit({ type: EventType.RUN_STARTED, threadId, runId });
    const beat = setInterval(() => void (gone || res.write(": working\n\n")), KEEPALIVE_MS);
    const id = `agui-${safe(threadId)}`;
    let held = false;
    try {
      if (running.has(id)) {
        return emit({ type: EventType.RUN_ERROR, message: "This conversation already has a job running. Wait for it to finish.", code: "busy" });
      }
      running.add(id);
      held = true;

      // OpenBot checks an address by posting a real run and hanging up on the first event. A client that
      // has left before the job starts never wanted one: nothing is made for it, and nothing is spent.
      await sleep(GRACE_MS);
      if (gone) return;

      const thread = await threadFor(id);
      const { text, files } = await read(message, thread);
      if (!thread.title) {
        thread.title = text.split("\n")[0].slice(0, 60) || "Task";
        await saveThread(thread);
      }
      const desktop = await viewerUrl(COMPUTER, thread.session);
      if (!thread.history.length) say(`On it. [Watch the computer or take over](${desktop})`);

      let bridgeStep = 0;
      const outcome = await work(thread, text, {
        files,
        on: {
          // The bridge's own steps are said once, with no outcome to wait for.
          step: (t) => {
            const key = `bridge-${++bridgeStep}`;
            begin(key, t, "bridge");
            end(key, "Done");
          },
          activity: (a: AgentActivity) => {
            // A step that takes time arrives running, then again with its outcome; a quick one arrives once.
            if (!calls.has(a.id)) begin(a.id, a.title, a.kind);
            if (a.state === "running") return;
            const page = [a.facts?.page?.title, a.facts?.page?.url].filter(Boolean).join(" — ");
            end(a.id, a.state === "completed" ? page || "Done" : `${a.state}${page ? `: ${page}` : ""}`);
          },
          progress: () => {},
        },
      });
      // A call left unanswered would read as one the client is asked to run.
      for (const key of [...calls.keys()]) end(key, "Not finished");

      const links = await Promise.all(outcome.files.map(async (f) => ({ name: f.name, url: await fileUrl(thread.id, f.name) })));
      let reply = await hostedLinks(outcome.text, thread.id, outcome.files);
      const unlinked = links.filter((f) => !reply.includes(f.url));
      if (unlinked.length) reply += `\n\nFiles:\n${unlinked.map((f) => `- [${f.name}](${f.url})`).join("\n")}`;

      if (outcome.state === "failed") {
        return emit({ type: EventType.RUN_ERROR, message: `The computer couldn't finish: ${reply}`, code: "failed" });
      }
      // A question ends the run like an answer does: the person's next message, a new run on this thread, answers it.
      say(outcome.state === "needs_input" ? `${reply}\n\nIf it needs you at the screen (a code, a check), [take over here](${desktop}).` : reply);
      emit({ type: EventType.RUN_FINISHED, threadId, runId, result: { state: outcome.state, desktop, files: links, ...(outcome.cost !== null ? { cost: outcome.cost } : {}) } });
    } catch (error) {
      log("ag-ui run failed:", error);
      for (const key of [...calls.keys()]) end(key, "Not finished");
      emit({ type: EventType.RUN_ERROR, message: `The computer couldn't take this on: ${(error as Error).message}`, code: "error" });
    } finally {
      clearInterval(beat);
      if (held) running.delete(id);
      if (!gone) res.end();
    }
  };
}

/** The AG-UI thread's thread, made on its first run. */
async function threadFor(id: string): Promise<ThreadRecord> {
  const saved = await readThread(id);
  if (saved) return saved;
  const thread = { ...newThread(COMPUTER), id };
  await saveThread(thread);
  return thread;
}

/** "Open a page" as open_a_page: a tool name a client can put back into words. */
function toolName(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.join("_").slice(0, 64) || "computer_step";
}

/** The message as the job's words, with the files it carries saved for upload. */
async function read(m: Message, thread: ThreadRecord): Promise<{ text: string; files: string[] }> {
  if (typeof m.content === "string") return { text: m.content.trim(), files: [] };
  const text: string[] = [];
  const files: string[] = [];
  // Read by shape, not by the current schema: clients from before 1.0 send a file as a "binary" part.
  const parts = (Array.isArray(m.content) ? m.content : []) as unknown as Record<string, any>[];
  for (const [i, p] of parts.entries()) {
    const name = String(p.metadata?.filename || p.filename || `file-${i + 1}`);
    const data: unknown = p.source?.type === "data" ? p.source.value : p.data;
    const url: unknown = p.source?.type === "url" ? p.source.value : p.url;
    if (p.type === "text" && typeof p.text === "string") text.push(p.text);
    else if (typeof data === "string") {
      const dir = at("inputs", safe(thread.id));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, safe(name));
      await writeFile(file, Buffer.from(data, "base64"), { mode: 0o600 });
      files.push(file);
    } else if (typeof url === "string") text.push(`(${name}: ${url})`);
  }
  return { text: text.join("\n").trim(), files };
}
