// Development: the engine (restarted on change) and Vite's UI server, side by side. Data
// goes to the repository's .data/, never to an installed studio's; .env.local, if present,
// holds a developer's overrides (README). The engine prints the link to open; it stays
// the same across restarts, so the browser stays signed in.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.STUDIO_DATA_DIR ||= ".data";
process.env.STUDIO_OPEN_ORIGIN ||= "http://127.0.0.1:5173";

if (!process.env.STUDIO_TOKEN) {
  const file = path.join(process.env.STUDIO_DATA_DIR, "dev-token");
  if (!existsSync(file)) {
    mkdirSync(process.env.STUDIO_DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(24).toString("base64url"), { mode: 0o600 });
  }
  process.env.STUDIO_TOKEN = readFileSync(file, "utf8").trim();
}

const children = [
  spawn("npx", ["tsx", "watch", "--clear-screen=false", "src/engine/main.ts"], { stdio: "inherit" }),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && stop());
