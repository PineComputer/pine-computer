// Pine Computer as an AG-UI agent, for chat apps that add a bot by its address (CopilotKit OpenBot, any
// CopilotKit app, any AG-UI client). An AG-UI thread is a thread with its own session on the Computer. A run
// is one message from the person: it starts a job, or answers the question the last run ended on. The steps
// stream as tool calls, the summary (or the question) is the assistant's message, and the files and the
// desktop come as links. Served by `pine-computer serve`.
//
// The work is handed to the Computer, not held by the connection. A client that stops listening doesn't stop
// the job: the next run on the thread joins it where it stands, or is told how it ended.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentActivity } from "@pinesandbox/computer";
import { EventType, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { Request, RequestHandler, Response } from "express";
import { at, exact, log, safe } from "../core/home.js";
import { store } from "../core/store.js";
import { newThread, readThread, resume, saveThread, work, type Listener, type Outcome, type ThreadRecord } from "../core/thread.js";
import { fileUrl, hostedLinks, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
/** How long a run waits before it starts its job, for a client that only came to see whether an agent answers. */
const GRACE_MS = 800;
/** A quiet stream is taken for a dead one (OpenBot ends a turn after 60 s of silence), so a long step says so. */
const KEEPALIVE_MS = 15_000;

/** A step as it starts, and as it ends. Kept so a run that joins late hears the steps it missed. */
type Step = { op: "begin"; key: string; title: string; kind: string } | { op: "end"; key: string; result: string };

/** How a job ended. */
type End =
  | { state: string; reply: string; desktop: string; files: { name: string; url: string }[]; cost: number | null; turn: string }
  | { error: string; code: "failed" | "error" };

/** A job on the Computer. It belongs to its thread, not to the run that started it. */
interface Job {
  steps: Step[];
  hear: Set<(step: Step) => void>;
  done: Promise<void>;
  end?: End;
  /** Whether some run was still listening when it ended, and so has told the person. */
  told: boolean;
  desktop: string;
}

/** Each thread's latest job, for as long as this process runs. */
const jobs = new Map<string, Job>();

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
    const show = (step: Step) => {
      if (step.op === "begin") {
        const toolCallId = randomUUID();
        calls.set(step.key, toolCallId);
        emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: toolName(step.title) });
        emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ step: step.title, kind: step.kind }) });
        emit({ type: EventType.TOOL_CALL_END, toolCallId });
      } else {
        const toolCallId = calls.get(step.key);
        if (!toolCallId) return;
        calls.delete(step.key);
        emit({ type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId, content: step.result, role: "tool" });
      }
    };

    /** The job's end, as this run's end. */
    const finish = (end: End, before = "", after = "") => {
      if ("error" in end) return emit({ type: EventType.RUN_ERROR, message: `${before}${end.error}`, code: end.code });
      // A question ends the run like an answer does: the person's next message, a new run on this thread, answers it.
      const screen = end.state === "needs_input" ? `\n\nIf it needs you at the screen (a code, a check), [take over here](${end.desktop}).` : "";
      say(`${before}${end.reply}${screen}${after}`);
      emit({ type: EventType.RUN_FINISHED, threadId, runId, result: { state: end.state, desktop: end.desktop, files: end.files, ...(end.cost !== null ? { cost: end.cost } : {}) } });
    };

    /** Hears a job from where it stands to its end: the steps so far, then each one as it happens. */
    const follow = async (job: Job, before = "", after = "") => {
      for (const step of job.steps) show(step);
      job.hear.add(show);
      await job.done;
      job.hear.delete(show);
      if (gone || !job.end) return;
      job.told = true;
      if ("turn" in job.end) await store().set(["heard", id], { turn: job.end.turn });
      await store().delete(["unheard", id]);
      finish(job.end, before, after);
    };
    const away = ["What you gave me earlier ended while you were away. Here is where it stands.\n\n", "\n\nIf your last message was something new, send it again."] as const;

    emit({ type: EventType.RUN_STARTED, threadId, runId });
    const beat = setInterval(() => void (gone || res.write(": working\n\n")), KEEPALIVE_MS);
    const id = `agui-${exact(threadId)}`;
    try {
      const earlier = jobs.get(id);
      if (earlier && !earlier.end) {
        // The person came back while the job is still going: they join it. Their message isn't a new job.
        say(`Still working on what you gave me earlier. [Watch the computer or take over](${earlier.desktop})`);
        return await follow(earlier);
      }
      if (earlier?.end && !earlier.told) {
        // The job ended with nobody listening. This run says how, and stops there: the person hasn't seen
        // the result, or the question, that their message would otherwise be taken as a reply to.
        earlier.told = true;
        await store().delete(["unheard", id]);
        if (!(await heard(id, earlier.end))) return finish(earlier.end, "error" in earlier.end ? "What you gave me earlier didn't finish: " : away[0], away[1]);
      }
      if (!earlier) {
        // Nothing in this process: the job may belong to one that restarted, or to another one beside it.
        const saved = await readThread(id);
        if (saved?.job) {
          const desktop = await viewerUrl(COMPUTER, saved.session);
          say(`Picking up what you gave me earlier. [Watch the computer or take over](${desktop})`);
          return await follow(start(id, saved, desktop, (on) => resume(saved, { on }) as Promise<Outcome>), "", away[1]);
        }
        const unheard = await store().get<End>(["unheard", id]);
        if (unheard) {
          await store().delete(["unheard", id]);
          if (!(await heard(id, unheard))) return finish(unheard, "error" in unheard ? "What you gave me earlier didn't finish: " : away[0], away[1]);
        }
      }

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
      await follow(start(id, thread, desktop, (on) => work(thread, text, { files, on })));
    } catch (error) {
      log("ag-ui run failed:", error);
      emit({ type: EventType.RUN_ERROR, message: `The computer couldn't take this on: ${(error as Error).message}`, code: "error" });
    } finally {
      clearInterval(beat);
      if (!gone) res.end();
    }
  };
}

/** Hands the job to the Computer. It runs to its end whether or not anyone is listening. */
function start(id: string, thread: ThreadRecord, desktop: string, run: (on: Listener) => Promise<Outcome>): Job {
  const job: Job = { steps: [], hear: new Set(), done: Promise.resolve(), told: false, desktop };
  const open = new Set<string>();
  const push = (step: Step) => {
    if (step.op === "begin") open.add(step.key);
    else open.delete(step.key);
    job.steps.push(step);
    for (const hear of job.hear) hear(step);
  };
  let bridgeStep = 0;
  job.done = (async () => {
    try {
      const outcome = await run({
        // The bridge's own steps are said once, with no outcome to wait for.
        step: (t) => {
          const key = `bridge-${++bridgeStep}`;
          push({ op: "begin", key, title: t, kind: "bridge" });
          push({ op: "end", key, result: "Done" });
        },
        activity: (a: AgentActivity) => {
          // A step that takes time arrives running, then again with its outcome; a quick one arrives once.
          if (!open.has(a.id)) push({ op: "begin", key: a.id, title: a.title, kind: a.kind });
          if (a.state === "running") return;
          const page = [a.facts?.page?.title, a.facts?.page?.url].filter(Boolean).join(" — ");
          push({ op: "end", key: a.id, result: a.state === "completed" ? page || "Done" : `${a.state}${page ? `: ${page}` : ""}` });
        },
        progress: () => {},
      });
      const links = await Promise.all(outcome.files.map(async (f) => ({ name: f.name, url: await fileUrl(thread.id, f.name) })));
      let reply = await hostedLinks(outcome.text, thread.id, outcome.files);
      const unlinked = links.filter((f) => !reply.includes(f.url));
      if (unlinked.length) reply += `\n\nFiles:\n${unlinked.map((f) => `- [${f.name}](${f.url})`).join("\n")}`;
      job.end = outcome.state === "failed" ? { error: `The computer couldn't finish: ${reply}`, code: "failed" } : { state: outcome.state, reply, desktop, files: links, cost: outcome.cost, turn: outcome.turnId };
    } catch (error) {
      log("ag-ui job failed:", error);
      job.end = { error: `The computer couldn't take this on: ${(error as Error).message}`, code: "error" };
    } finally {
      // A call left unanswered would read as one the client is asked to run.
      for (const key of [...open]) push({ op: "end", key, result: "Not finished" });
    }
    // Once the runs that were listening have had their turn: an end nobody heard is kept for the next run,
    // which may reach a process that never held this job.
    setImmediate(async () => {
      if (job.told || !job.end || (await heard(id, job.end))) return;
      await store().set(["unheard", id], job.end).catch((error) => log("keeping an unheard end failed:", error));
    });
  })();
  jobs.set(id, job);
  return job;
}

/** Whether a run has already told the person this end: one on another process, which followed the same job. */
async function heard(id: string, end: End): Promise<boolean> {
  return "turn" in end && (await store().get<{ turn: string }>(["heard", id]))?.turn === end.turn;
}

/** The AG-UI thread's thread, made on its first run. */
async function threadFor(id: string): Promise<ThreadRecord> {
  // Two first runs at once must end up with one thread, and one session.
  return store().lock(`thread-${id}`, async () => {
    const saved = await readThread(id);
    if (saved) return saved;
    const thread = { ...newThread(COMPUTER), id };
    await saveThread(thread);
    return thread;
  });
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
