// Drives `pine-computer acp` the way a chat app would: one thread, several messages, each turn's updates
// printed as they arrive.
//
//   node scripts/acp-smoke.mjs "a job" ["a reply" ...]
//
// A message "/reload" restarts the agent process and reopens the thread (session/load), as an app does
// after a restart. "/cancel 8 a job" sends the job and cancels it after 8 seconds.

import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const messages = process.argv.slice(2);
if (!messages.length) throw new Error('Usage: node scripts/acp-smoke.mjs "a job" ["a reply" | "/reload" | "/cancel 8 a job" ...]');

const started = Date.now();
const t = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
const titles = new Map();
let sessionId;

function show(u) {
  if (u.sessionUpdate === "agent_message_chunk") console.log(`${t()}  says: ${u.content.type === "text" ? u.content.text.trim() : `[${u.content.type}] ${u.content.name ?? ""} ${u.content.uri ?? ""}`}`);
  else if (u.sessionUpdate === "user_message_chunk") console.log(`${t()}  (replay) you: ${u.content.text}`);
  else if (u.sessionUpdate === "agent_thought_chunk") console.log(`${t()}  … ${u.content.text.trim()}`);
  else if (u.sessionUpdate === "tool_call") {
    titles.set(u.toolCallId, u.title);
    console.log(`${t()}  ▶ ${u.title} (${u.kind}, ${u.status})`);
  } else if (u.sessionUpdate === "tool_call_update" && (u.status === "completed" || u.status === "failed")) {
    console.log(`${t()}  ${u.status === "completed" ? "✓" : "✗"} ${u.title || titles.get(u.toolCallId) || u.toolCallId}`);
  } else if (u.sessionUpdate === "session_info_update") console.log(`${t()}  title: ${u.title}`);
}

/** One agent process, until the messages run out or one asks for a reload. Returns the rest. */
async function connect(queue) {
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "acp"], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  let rest = [];
  await acp
    .client({ name: "acp-smoke" })
    .onNotification(acp.methods.client.session.update, (ctx) => show(ctx.params.update))
    .connectWith(stream, async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      console.log(`${t()}  agent: ${init.agentInfo?.title} ${init.agentInfo?.version}, loadSession: ${init.agentCapabilities?.loadSession}`);
      if (sessionId) {
        await ctx.request(acp.methods.agent.session.load, { sessionId, cwd: process.cwd(), mcpServers: [] });
        console.log(`${t()}  [thread reopened]`);
      } else {
        ({ sessionId } = await ctx.request(acp.methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] }));
      }
      for (let i = 0; i < queue.length; i++) {
        const message = queue[i];
        if (message === "/reload") {
          rest = queue.slice(i + 1);
          return;
        }
        const cancel = message.match(/^\/cancel (\d+) (.+)$/s);
        const text = cancel ? cancel[2] : message;
        console.log(`\n${t()}  you: ${text}`);
        const timer = cancel && setTimeout(() => {
          console.log(`${t()}  [cancelling]`);
          void ctx.notify(acp.methods.agent.session.cancel, { sessionId });
        }, Number(cancel[1]) * 1000);
        const r = await ctx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] });
        if (timer) clearTimeout(timer);
        console.log(`${t()}  [turn ended: ${r.stopReason}]`);
      }
    });
  child.kill();
  return rest;
}

let queue = messages;
while (queue.length) {
  queue = await connect(queue);
  if (queue.length) console.log(`\n${t()}  [restarting the agent process]`);
}
