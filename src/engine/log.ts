// The studio's logs, kept in the data folder so a maker can send them (diagnostics.ts): what a
// process says on its console, timed, in logs/<name>.log, which starts again past a few MB with
// the one before kept beside it. The engine keeps "engine"; the desktop shell, where updates
// run, keeps "desktop". The console prints as it always did.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { DATA_DIR } from "./config.ts";

export type LogName = "engine" | "desktop";

const LIMIT = 5 * 1024 * 1024;

function logFile(name: LogName): string {
  return path.join(DATA_DIR, "logs", `${name}.log`);
}

function write(file: string, level: string, text: string): void {
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LIMIT) renameSync(file, `${file}.1`);
    appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
  } catch {
    // A log that can't be written mustn't stop the process.
  }
}

/** From now on, what this process says goes to its log too, and so does a crash. */
export function keepLog(name: LogName): void {
  const file = logFile(name);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // Nor may a log folder that can't be made.
  }
  for (const level of ["debug", "log", "info", "warn", "error"] as const) {
    const print = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      print(...args);
      write(file, level, format(...args));
    };
  }
  process.on("uncaughtExceptionMonitor", (error) => write(file, "crash", error.stack ?? String(error)));
}

/** A log's last lines, the file before it included when this one is short. */
export function logTail(name: LogName, lines: number): string[] {
  const read = (file: string) => {
    try {
      return readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const file = logFile(name);
  return [...read(`${file}.1`), ...read(file)].slice(-lines);
}
