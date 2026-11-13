import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const example = readme.match(/```ts\n([\s\S]*?)\n```/)[1];
const helpers = `
declare const store: { saveCredentials(id: string, data: string): Promise<void> };
declare const message: { id: string };
declare const vault: { get(name: string): Promise<string> };
declare function upsertStep(id: string, state: string, title: string): void;
declare function ask(question: string): Promise<string>;
declare function save(path: string, bytes: Uint8Array): Promise<void>;
`;

test("README example type-checks against the installed SDK", () => {
  const file = path.join(root, "readme-example.ts");
  const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => name === file ? ts.createSourceFile(name, helpers + example, options.target, true) : getSourceFile(name, ...args);
  const errors = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
  }));
});

const code = ts.transpileModule(example.replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction("Client", "Credentials", "store", "message", "vault", "upsertStep", "ask", "save", code);

function fixture(states) {
  let turn = { turnId: "turn-1", state: "running" };
  let sequence = 1;
  const seen = { answers: [], waits: [], files: [], steps: [], learned: 0, streamClosed: false };
  const secrets = { PORTAL_PASSWORD: "fixture-password" };
  const session = {
    agent: {
      async run() { return turn; },
      async wait(id, options) {
        assert.equal(id, turn.turnId);
        seen.waits.push(options);
        const state = states.shift();
        assert.ok(state, "the example must finish once the turn ends");
        turn = { turnId: id, state, question: `Question ${sequence}`, result: state === "completed" ? { artifacts: [{ relativePath: "invoice.pdf" }] } : { summary: "Supplier portal unavailable" } };
        return turn;
      },
      async answer(id, answer, options) {
        assert.equal(id, turn.turnId);
        assert.equal(turn.state, "needs_input");
        seen.answers.push({ answer, secrets: options?.secrets });
        return (turn = { turnId: `turn-${++sequence}`, state: "running" });
      },
      async *events({ signal } = {}) {
        try {
          yield { activity: () => ({ id: "step-1", state: "completed", title: "Read the portal" }), result: () => undefined };
          yield { activity: () => undefined, result: () => ({ terminalReason: "needs_input" }) };
          if (signal && !signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        } finally {
          seen.streamClosed = true;
        }
      },
    },
    async readFile() {
      assert.equal(turn.state, "completed", "read files only after completion");
      return new Uint8Array([1, 2, 3]);
    },
    async learn() {
      assert.equal(turn.state, "completed", "learn only after completion");
      seen.learned++;
    },
  };
  return {
    seen,
    run: () => execute(
      { fromEnv: () => ({ createComputer: async () => ({ createSession: async () => session }) }) },
      { generate: async () => ({ id: "computer-1", serialize: () => "fixture-credentials" }) },
      { saveCredentials: async () => {} }, { id: "message-1" }, { get: async () => secrets.PORTAL_PASSWORD },
      (...step) => seen.steps.push(step), async (question) => `Answer to ${question}`,
      async (name, bytes) => seen.files.push({ name, bytes: [...bytes] }),
    ),
  };
}

test("README waits through repeated questions and running/canceling reads", async () => {
  const { run, seen } = fixture(["needs_input", "running", "needs_input", "canceling", "completed"]);
  await run();
  assert.equal(seen.answers.length, 2);
  assert.ok(seen.answers.every((answer) => answer.secrets?.PORTAL_PASSWORD === "fixture-password"));
  assert.equal(seen.waits.length, 5);
  assert.ok(seen.waits.every((options) => options.timeoutMs > 0));
  assert.deepEqual(seen.files, [{ name: "invoice.pdf", bytes: [1, 2, 3] }]);
  assert.equal(seen.learned, 1);
  assert.equal(seen.steps.length, 1);
  assert.equal(seen.streamClosed, true);
});

for (const state of ["failed", "canceled"]) {
  test(`README does not collect files or learn after ${state}`, async () => {
    const { run, seen } = fixture([state]);
    await assert.rejects(run, /Supplier portal unavailable/);
    assert.equal(seen.learned, 0);
    assert.deepEqual(seen.files, []);
    assert.equal(seen.streamClosed, true);
  });
}

test("CLI loads file configuration before its adapters, with environment precedence", async () => {
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PINE_")));
  const cli = new URL("../dist/cli.js", import.meta.url).href;
  const child = `
    import assert from 'node:assert/strict';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
    globalThis.fetch = () => { throw new Error('Network disabled by this check'); };
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(new URL(cli)))}, 'status'];
    await import(${JSON.stringify(cli)});
    const { IDLE_SECONDS } = await import('./dist/core/computer.js');
    assert.equal(IDLE_SECONDS, Number(process.env.CHECK_IDLE));
    const { viewerUrl } = await import('./dist/viewer/server.js');
    assert.equal(new URL(await viewerUrl('check')).port, process.env.CHECK_PORT);
    const { mcpServer } = await import('./dist/mcp/server.js');
    const { store } = await import('./dist/core/store.js');
    const [left, right] = InMemoryTransport.createLinkedPair();
    const server = mcpServer({ hosted: true });
    const client = new Client({ name: 'env-check', version: '1' });
    try {
      await server.connect(right);
      await client.connect(left);
      assert.equal((await client.listTools()).tools.length, 4);
      const result = await client.callTool({ name: 'computer_task', arguments: { task: 'local config check' } });
      assert.match(result.content[0].text, /Set PINE_SANDBOX_API_KEY/);
      const ids = await store().list(['threads']);
      assert.equal(ids.length, 1);
      assert.equal((await store().get(['threads', ids[0]])).computer, process.env.CHECK_COMPUTER);
    } finally {
      await client.close();
      await server.close();
    }
  `;
  for (const mode of ["file", "environment", "defaults"]) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pine-env-check-"));
    try {
      if (mode !== "defaults") await writeFile(path.join(dir, "env"), "PINE_COMPUTER=file-computer\nPINE_IDLE_TIMEOUT_SECONDS=321\nPINE_VIEWER_PORT=56789\n");
      const env = { ...baseEnv, PINE_COMPUTER_HOME: dir, CHECK_COMPUTER: mode === "defaults" ? "default" : "file-computer", CHECK_IDLE: mode === "defaults" ? "1800" : "321", CHECK_PORT: mode === "defaults" ? "4777" : "56789" };
      if (mode === "environment") Object.assign(env, { PINE_COMPUTER: "env-computer", PINE_IDLE_TIMEOUT_SECONDS: "654", PINE_VIEWER_PORT: "56790", CHECK_COMPUTER: "env-computer", CHECK_IDLE: "654", CHECK_PORT: "56790" });
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
      assert.equal(result.status, 0, `${mode}: ${result.error ?? result.stderr}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});


test("CLI version probes do not need a readable config file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pine-version-check-"));
  try {
    await mkdir(path.join(dir, "env"));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "acp", "--version"], {
      env: { ...process.env, PINE_COMPUTER_HOME: dir }, encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^pine-computer 0\.1\.0\n$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
