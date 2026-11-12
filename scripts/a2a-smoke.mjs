// Drives `pine-computer serve` the way an A2A platform does: finds the agent from its card, sends each
// argument as a message in one context, and prints every event. A message after an input-required task
// answers that task; "/cancel 8 a job" cancels the job after eight seconds.
//
//   node scripts/a2a-smoke.mjs "a job" "the answer to its question"

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Role } from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory } from "@a2a-js/sdk/client";

const base = process.env.PINE_SERVE_URL ?? "http://127.0.0.1:4778";
const home = process.env.PINE_COMPUTER_HOME ?? path.join(homedir(), ".pine-computer");
const token = process.env.PINE_SERVE_TOKEN ?? JSON.parse(readFileSync(path.join(home, "serve.json"), "utf8")).token;
const authed = (url, init = {}) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${token}` } });

const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory({ fetchImpl: authed })] }).createFromUrl(base);
const card = await client.getAgentCard();
console.log(`agent: ${card.name} ${card.version} · ${card.supportedInterfaces.map((i) => `${i.protocolBinding} ${i.url}`).join(", ")}`);

const contextId = randomUUID();
const started = Date.now();
const t = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
const said = (m) => m?.parts.map((p) => (p.content?.$case === "text" ? p.content.value : `[${p.content?.$case} ${p.filename}]`)).join(" ") ?? "";
const STATE = { 1: "submitted", 2: "working", 3: "completed", 4: "failed", 5: "canceled", 6: "input-required", 7: "rejected", 8: "auth-required" };

let waitingTask = "";
for (const arg of process.argv.slice(2)) {
  const cancel = /^\/cancel (\d+) (.+)$/s.exec(arg);
  const text = cancel ? cancel[2] : arg;
  const message = { messageId: randomUUID(), contextId, taskId: waitingTask, role: Role.ROLE_USER, parts: [{ content: { $case: "text", value: text }, mediaType: "text/plain", filename: "", metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [] };
  console.log(`\n${t()}  > ${text}${waitingTask ? "  (answering its question)" : ""}`);
  let taskId = waitingTask;
  waitingTask = "";
  let timer;
  for await (const event of client.sendMessageStream({ tenant: "", message, configuration: undefined, metadata: undefined })) {
    const p = event.payload;
    if (p?.$case === "task") {
      taskId = p.value.id;
      console.log(`${t()}  task ${taskId.slice(0, 8)} · ${STATE[p.value.status?.state] ?? p.value.status?.state}`);
      if (cancel && !timer) timer = setTimeout(() => client.cancelTask({ tenant: "", id: taskId, metadata: undefined }).then((x) => console.log(`${t()}  cancel → ${STATE[x.status?.state]}`), (e) => console.log(`${t()}  cancel failed: ${e.message}`)), Number(cancel[1]) * 1000);
    } else if (p?.$case === "statusUpdate") {
      const state = STATE[p.value.status?.state] ?? p.value.status?.state;
      const meta = p.value.status?.message?.metadata;
      console.log(`${t()}  ${state.padEnd(14)} ${said(p.value.status?.message)}${meta?.step ? `  {${meta.step.kind}}` : ""}`);
      if (state === "input-required") waitingTask = taskId;
    } else if (p?.$case === "artifactUpdate") {
      const a = p.value.artifact;
      const parts = a.parts.map((x) => (x.content?.$case === "raw" ? `${x.filename} (${x.mediaType}, ${x.content.value.length} bytes inline)` : x.content?.$case === "url" ? `${x.filename} → ${x.content.value}` : `${x.content?.value.length} chars`));
      console.log(`${t()}  artifact "${a.name}": ${parts.join(", ")}`);
    } else if (p?.$case === "message") {
      console.log(`${t()}  message: ${said(p.value)}`);
    }
  }
  clearTimeout(timer);
  if (taskId) {
    const task = await client.getTask({ tenant: "", id: taskId, historyLength: undefined });
    console.log(`${t()}  tasks/get → ${STATE[task.status?.state]}, ${task.artifacts.length} artifacts, ${task.history.length} messages in history`);
  }
}
