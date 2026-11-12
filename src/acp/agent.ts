// Pine Computer as an ACP agent: an app that speaks the Agent Client Protocol (OpenMausBot, OpenBot,
// Zed) starts `pine-computer acp` and gets a bot whose work happens on a Computer. Each ACP session is a
// chat thread with its own session on the Computer. A message starts a job; the agent's steps stream
// back as tool calls; its summary is the reply. When the agent stops on a question, the turn ends with
// the question, and the person's next message answers it. Returned files land in the thread's folder.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentActivity } from "@pinesandbox/computer";
import { log } from "../core/home.js";
import { newThread, readThread, saveThread, site, work, type Outcome, type ThreadRecord } from "../core/thread.js";
import { ensureViewer, viewerUrl } from "../viewer/server.js";

const COMPUTER = process.env.PINE_COMPUTER || "default";
const VERSION = "0.1.0";

type Client = acp.AgentContext;

const KIND: Record<string, acp.ToolKind> = { browser: "fetch", command: "execute", file: "edit", skill: "other", tool: "other" };
const STATUS: Record<string, acp.ToolCallStatus> = { running: "in_progress", completed: "completed" };

class PineAgent {
  private running = new Map<string, AbortController>();
  /** Activities seen per thread, so a repeat is an update, not a new step. */
  private seen = new Map<string, Set<string>>();
  /** Sessions the app opened for its own background writing, which the Computer turns away. */
  private chores = new Set<string>();

  initialize(): acp.InitializeResponse {
    void ensureViewer().catch((error) => log("viewer:", error.message));
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
      agentInfo: { name: "pine-computer", title: "Pine Computer", version: VERSION },
      authMethods: [],
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (chore(params.cwd)) {
      const sessionId = `chore-${randomUUID()}`;
      this.chores.add(sessionId);
      return { sessionId };
    }
    // The app's MCP servers stay with the app: the Computer brings its own browser, shell, files and skills.
    const thread = newThread(COMPUTER, params.cwd);
    await saveThread(thread);
    return { sessionId: thread.id };
  }

  async loadSession(params: acp.LoadSessionRequest, cx: Client): Promise<acp.LoadSessionResponse> {
    const thread = await readThread(params.sessionId);
    if (!thread) throw acp.RequestError.invalidParams({ sessionId: params.sessionId }, "No such thread");
    if (params.cwd && thread.cwd !== params.cwd) {
      thread.cwd = params.cwd;
      await saveThread(thread);
    }
    // A client that shows history (an editor) gets the thread replayed; the rest ignore replays.
    for (const x of thread.history) {
      await this.say(cx, thread.id, { sessionUpdate: "user_message_chunk", content: { type: "text", text: x.prompt } }, true);
      await this.say(cx, thread.id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: x.reply } }, true);
    }
    return {};
  }

  async prompt(params: acp.PromptRequest, cx: Client): Promise<acp.PromptResponse> {
    if (this.chores.has(params.sessionId)) {
      throw acp.RequestError.invalidRequest(undefined, "Pine Computer takes jobs from people. It doesn't write the app's memory notes.");
    }
    const thread = await readThread(params.sessionId);
    if (!thread) throw acp.RequestError.invalidParams({ sessionId: params.sessionId }, "No such thread");
    this.running.get(thread.id)?.abort();
    const controller = new AbortController();
    this.running.set(thread.id, controller);
    const { text, sent, files } = read(params.prompt);
    if (!thread.title) {
      thread.title = text.split("\n")[0].slice(0, 60) || "Chat";
      await saveThread(thread);
      await this.say(cx, thread.id, { sessionUpdate: "session_info_update", title: thread.title });
    }
    const first = thread.history.length === 0;
    const open = new Set<string>();
    const seen = this.seen.get(thread.id) ?? new Set<string>();
    this.seen.set(thread.id, seen);
    const step = (id: string, title: string, status: acp.ToolCallStatus, kind: acp.ToolKind = "other", rawInput?: Record<string, unknown>, output?: string) => {
      if (status === "completed" || status === "failed") open.delete(id);
      else open.add(id);
      const content: acp.ToolCallContent[] | undefined = output ? [{ type: "content", content: { type: "text", text: output } }] : undefined;
      const update: acp.SessionUpdate = seen.has(id)
        ? { sessionUpdate: "tool_call_update", toolCallId: id, status, ...(title ? { title } : {}), ...(content ? { content } : {}) }
        : { sessionUpdate: "tool_call", toolCallId: id, title, kind, status, rawInput, ...(content ? { content } : {}) };
      seen.add(id);
      return this.say(cx, thread.id, update);
    };
    let bridgeStep = 0;
    let lastBridge = "";

    try {
      if (first) {
        const link = await viewerUrl(COMPUTER, thread.session);
        await this.say(cx, thread.id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `On it. [Watch the computer or take over](${link})\n\n` } });
      }
      const outcome = await work(thread, text, {
        files,
        sent,
        signal: controller.signal,
        on: {
          step: (title) => {
            if (lastBridge) void step(lastBridge, "", "completed");
            lastBridge = `bridge-${thread.id.slice(0, 8)}-${Date.now()}-${++bridgeStep}`;
            void step(lastBridge, title, "in_progress");
          },
          activity: (a: AgentActivity) => {
            if (lastBridge) {
              void step(lastBridge, "", "completed");
              lastBridge = "";
            }
            // A step names its page only once it ends, so two running "Open a page" steps look alike; the step's id
            // tells them apart for apps that flag the same call repeated (OpenMausBot's loop guard).
            // Apps that keep a step's first title (OpenMausBot) show where it went as its output.
            const page = a.facts?.page?.title || a.facts?.page?.url;
            const done = a.state !== "running";
            const title = done ? `${a.title}${site(a.facts?.page?.url)}` : a.title;
            const output = done ? [a.facts?.page?.title, a.facts?.page?.url].filter(Boolean).join(" — ") : "";
            // A command step carries its command, so apps word it as one ("Ran pdfinfo", the line on hover).
            const command = a.kind === "command" ? /^Run (.+)$/s.exec(a.title)?.[1] : undefined;
            void step(a.id, title, STATUS[a.state] ?? "failed", KIND[a.kind] ?? "other", { step: a.id, kind: a.kind, ...(command ? { command } : {}), ...(page ? { page } : {}), ...(a.facts?.steps ? { steps: a.facts.steps } : {}) }, output);
          },
          progress: (t) => void this.say(cx, thread.id, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: `${t}\n` } }),
        },
      });
      if (lastBridge) await step(lastBridge, "", "completed");
      await this.reply(cx, thread, outcome);
      return { stopReason: outcome.state === "canceled" ? "cancelled" : "end_turn" };
    } catch (error) {
      if (controller.signal.aborted) return { stopReason: "cancelled" };
      log("prompt failed:", error);
      await this.say(cx, thread.id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `The computer couldn't take this on: ${(error as Error).message}` } });
      return { stopReason: "end_turn" };
    } finally {
      // v1 has no cancelled status for a tool call: anything left open ends as failed.
      for (const id of open) await this.say(cx, thread.id, { sessionUpdate: "tool_call_update", toolCallId: id, status: "failed" });
      if (this.running.get(thread.id) === controller) this.running.delete(thread.id);
    }
  }

  cancel(params: acp.CancelNotification): void {
    this.running.get(params.sessionId)?.abort();
  }

  private async reply(cx: Client, thread: ThreadRecord, outcome: Outcome): Promise<void> {
    let text = outcome.text;
    if (outcome.state === "failed") text = `The computer couldn't finish: ${text}`;
    if (outcome.state !== "completed" && outcome.state !== "canceled") text += `\n\n[Watch the computer or take over](${await viewerUrl(COMPUTER, thread.session)})`;
    // Chat apps pick files up from links in the text (OpenMausBot ignores resource_link blocks), so each file is linked once.
    const unlinked = outcome.files.filter((f) => !text.includes(pathToFileURL(f.path).href));
    if (unlinked.length) text += `\n\nFiles:\n${unlinked.map((f) => `- [${f.name}](${pathToFileURL(f.path).href})`).join("\n")}`;
    await this.say(cx, thread.id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    for (const f of outcome.files) {
      await this.say(cx, thread.id, { sessionUpdate: "agent_message_chunk", content: { type: "resource_link", uri: `file://${f.path}`, name: f.name, size: f.size } });
    }
  }

  private say(cx: Client, sessionId: string, update: acp.SessionUpdate, replay = false): Promise<void> {
    return cx.notify(acp.methods.client.session.update, { sessionId, update, ...(replay ? { _meta: { isReplay: true } } : {}) }).catch((error: Error) => log("update:", error.message));
  }
}

/** OpenMausBot runs memory upkeep with the bot's engine when the engine has no quick text call (every ACP
 * engine), each call a fresh session in an empty temporary folder (omb-acp-memory-…; omb-acp-models-… lists
 * models and sends no prompt). A whole cloud computer per chore is waste, and each one would take a session
 * from a real conversation. */
function chore(cwd: string | undefined): boolean {
  return !!cwd && /^omb-acp-[a-z]+-[A-Za-z0-9]{6}$/.test(path.basename(cwd));
}

/** The person's message as text, plus the local files they attached. */
function read(blocks: acp.ContentBlock[]): { text: string; sent?: string; files: string[] } {
  const text: string[] = [];
  const files: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") text.push(b.text);
    else if (b.type === "resource_link") {
      if (b.uri.startsWith("file://")) files.push(fileURLToPath(b.uri));
      else text.push(`(${b.name}: ${b.uri})`);
    } else if (b.type === "resource" && "text" in b.resource) {
      text.push(`\n${path.basename(b.resource.uri)}:\n${b.resource.text}`);
    }
  }
  return { ...ownWords(text.join("\n").trim()), files };
}

/** OpenMausBot puts its instructions for its own agents ahead of the person's words, ending with the time the message
 * was sent. They name tools and settings this Computer doesn't have ("Works on is Off"), so the job gets the words
 * alone, and the time (which carries the person's time zone) as context. */
function ownWords(text: string): { text: string; sent?: string } {
  const clock = /^Current time when this message was sent: (.+)$/m.exec(text);
  if (!clock) return { text };
  return { text: text.slice(clock.index + clock[0].length).trim(), sent: clock[1] };
}

export function serveAcp(): void {
  const agent = new PineAgent();
  const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>);
  acp
    .agent({ name: "pine-computer" })
    .onRequest("initialize", () => agent.initialize())
    .onRequest("authenticate", () => ({}))
    .onRequest("session/new", (ctx) => agent.newSession(ctx.params))
    .onRequest("session/load", (ctx) => agent.loadSession(ctx.params, ctx.client))
    .onRequest("session/prompt", (ctx) => agent.prompt(ctx.params, ctx.client))
    .onNotification("session/cancel", (ctx) => agent.cancel(ctx.params))
    .connect(stream);
}
