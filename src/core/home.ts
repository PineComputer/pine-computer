// Where the bridge keeps what outlives a process: each Computer's credentials and binding, each chat
// thread's session, the viewer's key. One folder (~/.pine-computer, or PINE_COMPUTER_HOME), readable by
// this user only, like a CLI's login. Several processes share it (an app may start one per chat), so
// writes are atomic and the steps that must not interleave take a lock.

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const HOME = process.env.PINE_COMPUTER_HOME || path.join(homedir(), ".pine-computer");

/** The Pine project key can live here once, instead of in every app's settings. */
export function loadEnv(): void {
  const file = path.join(HOME, "env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export const at = (...parts: string[]) => path.join(HOME, ...parts);

/** A file or folder name from text that came from elsewhere: a Computer's name, a session's. */
export const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "default";

/** A name from text someone else chose, when two different texts must never share one. `safe` alone folds them. */
export const exact = (text: string) => (text.length <= 64 && safe(text) === text ? text : createHash("sha256").update(text).digest("hex").slice(0, 40));

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs fn while holding a lock folder. A lock older than `staleMs` belonged to a process that died. */
export async function withLock<T>(name: string, fn: () => Promise<T>, staleMs = 180_000): Promise<T> {
  const dir = at("locks", `${safe(name)}.lock`);
  await mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      await mkdir(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const since = await stat(dir).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (since > staleMs) await rm(dir, { recursive: true, force: true });
      else await sleep(250);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Logs go to stderr: on an ACP or MCP process, stdout is the protocol. */
export const log = (...args: unknown[]) => console.error("[pine-computer]", ...args);
