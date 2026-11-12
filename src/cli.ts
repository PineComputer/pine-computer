#!/usr/bin/env node
// pine-computer: hand chat threads to a Pine Computer.
//
//   pine-computer acp                 an ACP agent on stdio, for apps that run agents (OpenMausBot, Zed)
//   pine-computer mcp                 MCP tools on stdio, for agents that hand work off (Claude Code, Codex)
//   pine-computer run "a job"         one job from the terminal, its steps as it goes
//   pine-computer serve               MCP and A2A over HTTP, with the desktop pages, for hosted apps
//   pine-computer viewer              serves the live desktop pages (started on its own when needed)
//   pine-computer desktop             the Computer's desktop page, to pin in a chat app
//   pine-computer status | stop       the Computer's state; stop it, keeping its sign-ins
//
// The Computer is PINE_COMPUTER (default "default"). The Pine key comes from the environment or from
// ~/.pine-computer/env.

import { serveAcp } from "./acp/agent.js";
import { describe, stopComputer } from "./core/computer.js";
import { serveMcp } from "./mcp/server.js";
import { loadEnv } from "./core/home.js";
import { newThread, saveThread, work } from "./core/thread.js";
import { serve } from "./serve.js";
import { ensureViewer, serveViewer, viewerUrl } from "./viewer/server.js";

// Apps check an engine by running its whole configured command with --version ("pine-computer acp --version").
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log("pine-computer 0.1.0");
  process.exit(0);
}

loadEnv();
const [command, ...rest] = process.argv.slice(2);
const computer = process.env.PINE_COMPUTER || "default";

async function main(): Promise<void> {
  switch (command) {
    case "acp":
      return serveAcp();
    case "mcp":
      return serveMcp();
    case "run": {
      const goal = rest.join(" ").trim();
      if (!goal) throw new Error('Usage: pine-computer run "what to do"');
      await ensureViewer();
      const thread = newThread(computer, process.cwd());
      await saveThread(thread);
      console.log(`Watch: ${await viewerUrl(computer, thread.session)}`);
      const started = Date.now();
      const t = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
      const outcome = await work(thread, goal, {
        on: {
          step: (text) => console.log(`${t()}  · ${text}`),
          activity: (a) => a.state !== "running" && console.log(`${t()}  ${a.state === "completed" ? "✓" : "✗"} ${a.title}`),
          progress: (text) => console.log(`${t()}  … ${text}`),
        },
      });
      console.log(`\n${outcome.state}: ${outcome.text}`);
      for (const f of outcome.files) console.log(`  file: ${f.path}`);
      if (outcome.cost !== null) console.log(`  cost: $${outcome.cost.toFixed(2)}`);
      process.exit(outcome.state === "completed" ? 0 : outcome.state === "needs_input" ? 2 : 1);
    }
    case "serve":
      await serve();
      return new Promise(() => {});
    case "viewer": {
      if ((await serveViewer()) === "running") return console.log("The desktop pages are already served.");
      console.log(`Serving the desktop pages on http://127.0.0.1:${process.env.PINE_VIEWER_PORT ?? 4777}`);
      return new Promise(() => {});
    }
    case "desktop": {
      await ensureViewer();
      console.log(await viewerUrl(rest[0] || computer));
      return;
    }
    case "status":
      console.log(JSON.stringify(await describe(rest[0] || computer), null, 2));
      return;
    case "stop":
      console.log((await stopComputer(rest[0] || computer)) ? "Stopped. Sign-ins are kept." : "Nothing to stop.");
      return;
    default:
      console.log("Usage: pine-computer acp | mcp | serve | run \"a job\" | desktop | viewer | status | stop");
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
