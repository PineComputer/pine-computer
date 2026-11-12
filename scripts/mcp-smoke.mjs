// Drives `pine-computer mcp` the way an agent would: lists the tools, hands over a job, then sends each
// reply on the same thread. Prints every result and the progress steps on the way. With PINE_SERVE_URL set,
// it talks to `pine-computer serve` over Streamable HTTP instead, with the serve token.
//
//   node scripts/mcp-smoke.mjs "a job" ["a reply" ...]
//   PINE_SERVE_URL=http://127.0.0.1:4778 node scripts/mcp-smoke.mjs "a job"

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [first, ...replies] = process.argv.slice(2);
if (!first) throw new Error('Usage: node scripts/mcp-smoke.mjs "a job" ["a reply" ...]');

const served = process.env.PINE_SERVE_URL;
const home = process.env.PINE_COMPUTER_HOME ?? path.join(homedir(), ".pine-computer");
const token = () => process.env.PINE_SERVE_TOKEN ?? JSON.parse(readFileSync(path.join(home, "serve.json"), "utf8")).token;
const transport = served
  ? new StreamableHTTPClientTransport(new URL("/mcp", served), { requestInit: { headers: { authorization: `Bearer ${token()}` } } })
  : new StdioClientTransport({
      command: process.execPath,
      args: [new URL("../dist/cli.js", import.meta.url).pathname, "mcp"],
      env: process.env,
      stderr: "inherit",
    });
const client = new Client({ name: "mcp-smoke", version: "0.1.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const started = Date.now();
const t = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
let thread;
for (const task of [first, ...replies]) {
  console.log(`\n${t()}  task: ${task}`);
  const result = await client.callTool(
    { name: "computer_task", arguments: { task, ...(thread ? { thread } : {}), wait_seconds: 300 } },
    undefined,
    { timeout: 400_000, onprogress: (p) => console.log(`${t()}  · ${p.message}`) },
  );
  const text = result.content.map((c) => c.text).join("\n");
  console.log(`${t()}  result:\n${text.replace(/^/gm, "        ")}`);
  thread = text.match(/^thread: (\S+)/m)?.[1];
}
await client.close();
