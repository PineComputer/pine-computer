// The engine: the maker's Pine project (or the replay), the production line's clock, and
// the HTTP API on loopback.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { DATA_DIR, PORT } from "./config.ts";
import { setFleet } from "./computers.ts";
import { appInfo, initialFleet } from "./connection.ts";
import { db } from "./db.ts";
import { app, openLink } from "./http.ts";
import { keepLog } from "./log.ts";
import { startClock } from "./scheduler.ts";

/** One engine per data folder: two would drive the same Computers and spend twice. */
function claimDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const lock = path.join(DATA_DIR, "engine.pid");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      process.on("exit", () => rmSync(lock, { force: true }));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const other = Number(readFileSync(lock, "utf8"));
      if (other && running(other)) {
        console.error(`The studio is already running on this data folder (process ${other}): ${DATA_DIR}`);
        process.exit(1);
      }
      rmSync(lock, { force: true });
    }
  }
  throw new Error(`Couldn't claim the data folder ${DATA_DIR}.`);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

// The log first, so a start that fails is in it; then the data folder is ours, then the port:
// only then does the production line start.
keepLog("engine");
claimDataDir();
db();
const server = serve({ fetch: app().fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  setFleet(initialFleet());
  startClock();
  console.log(`Pine Drama Studio engine on 127.0.0.1:${info.port} — ${appInfo().mode}, data in ${DATA_DIR}`);
  // In the desktop app the shell opens the window itself; on its own, the engine prints the way in.
  const shell = (process as { parentPort?: { postMessage(message: unknown): void } }).parentPort;
  if (shell) shell.postMessage({ type: "ready", port: info.port });
  // Printed, not logged: the link carries this launch's token, and the log goes into diagnostics.
  else process.stdout.write(`Open ${openLink(process.env.STUDIO_OPEN_ORIGIN || `http://127.0.0.1:${info.port}`)}\n`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(`Port ${PORT} on 127.0.0.1 is taken by another program. Set STUDIO_PORT to another port, or 0 for any free one.`);
  process.exit(1);
});
