// Starts the packaged desktop app and checks that it stays up: CI's guard against a bundle that
// builds but can't run (.github/workflows/ci.yml). On Linux it runs under xvfb-run:
//
//   xvfb-run -a node scripts/smoke-desktop.mjs release/linux-unpacked/pine-drama-studio
//
// The app gets a data folder and a sealing key of its own. It passes when its engine is up
// within a minute and still answering twenty seconds later, the app is still running, and
// nothing in its output says it threw.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const READY_WITHIN = 60_000;
const STAY_UP = 20_000;
const THREW = /App threw an error|Uncaught|Unhandled/i;

const executable = process.argv[2];
if (!executable) {
  console.error("usage: node scripts/smoke-desktop.mjs <the packaged app's executable>");
  process.exit(2);
}
const data = mkdtempSync(path.join(tmpdir(), "studio-smoke-"));
// --no-sandbox: CI's container can't set up Chromium's sandbox; this checks start-up, not the sandbox.
const app = spawn(executable, ["--no-sandbox"], {
  env: { ...process.env, STUDIO_DATA_DIR: data, STUDIO_SECRET: randomBytes(32).toString("base64") },
  detached: true,
});
let output = "";
for (const stream of [app.stdout, app.stderr]) {
  stream.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
}
let exited;
app.on("exit", (code, signal) => (exited = `code ${code}, signal ${signal}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check() {
  const deadline = Date.now() + READY_WITHIN;
  let port;
  while (!port && !exited && Date.now() < deadline) {
    port = output.match(/engine on 127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) await sleep(250);
  }
  if (!port) return exited ? `the app exited (${exited}) before its engine was up` : "its engine wasn't up within a minute";
  await sleep(STAY_UP);
  if (exited) return `the app exited (${exited}) after its engine was up`;
  // Any answer will do: without the window's token the engine says 401.
  const status = await fetch(`http://127.0.0.1:${port}/api/app`).then((response) => response.status, () => 0);
  if (status !== 401) return `its engine didn't answer (${status || "no response"})`;
  const threw = output.match(THREW);
  if (threw) return `its output says "${threw[0]}"`;
  return undefined;
}

const failure = await check();
try {
  process.kill(-app.pid, "SIGKILL"); // the app, its helpers and its engine
} catch {
  // already gone
}
rmSync(data, { recursive: true, force: true });
if (failure) {
  console.error(`smoke: ${failure}`);
  process.exit(1);
}
console.log("smoke: the app started, and its engine is up and answering");
