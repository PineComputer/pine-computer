// Drives `pine-computer serve` the way an AG-UI app does (CopilotKit OpenBot runs a bot with the same
// client): posts each argument as the person's next message on one thread, with the conversation so far and
// the token as an Authorization header, and prints every event. A message after a question answers it.
//
//   node scripts/agui-smoke.mjs "a job" "the answer to its question, or a follow-up"

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";

const base = process.env.PINE_SERVE_URL ?? "http://127.0.0.1:4778";
const home = process.env.PINE_COMPUTER_HOME ?? path.join(homedir(), ".pine-computer");
const token = process.env.PINE_SERVE_TOKEN ?? JSON.parse(readFileSync(path.join(home, "serve.json"), "utf8")).token;

const agent = new HttpAgent({ url: `${base}/agui`, headers: { Authorization: `Bearer ${token}` }, threadId: randomUUID() });
console.log(`agent: ${agent.url} · thread ${agent.threadId.slice(0, 8)}`);

const started = Date.now();
const t = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
const line = (type, text = "") => console.log(`${t()}  ${type.padEnd(18)} ${text}`);

for (const text of process.argv.slice(2)) {
  console.log(`\n${t()}  > ${text}`);
  agent.addMessage({ id: randomUUID(), role: "user", content: text });
  const names = new Map();
  try {
    await agent.runAgent({ runId: randomUUID() }, {
      onEvent: ({ event: e }) => {
        if (e.type === "TOOL_CALL_START") names.set(e.toolCallId, e.toolCallName);
        if (e.type === "RUN_STARTED") line(e.type, `run ${e.runId.slice(0, 8)}`);
        else if (e.type === "TEXT_MESSAGE_CONTENT") line(e.type, e.delta);
        else if (e.type === "TOOL_CALL_START") line(e.type, e.toolCallName);
        else if (e.type === "TOOL_CALL_ARGS") line(e.type, e.delta);
        else if (e.type === "TOOL_CALL_RESULT") line(e.type, `${names.get(e.toolCallId)} → ${e.content}`);
        else if (e.type === "RUN_FINISHED") line(e.type, JSON.stringify(e.result));
        else if (e.type === "RUN_ERROR") line(e.type, `${e.code}: ${e.message}`);
        else line(e.type);
      },
    });
  } catch (error) {
    // The client throws on RUN_ERROR, after the event above has said why.
    console.log(`${t()}  run failed: ${error.message}`);
  }
  const roles = agent.messages.map((m) => (m.role === "assistant" && m.toolCalls?.length ? "assistant(tool call)" : m.role));
  console.log(`${t()}  the client now holds ${agent.messages.length} messages: ${roles.join(", ")}`);
}
