// The agent's public activity, followed for as long as the server runs and relayed to the page as steps:
// what it did, on which page. Progress only: how a turn ended comes from the follower's wait.

import "server-only";
import { ApiError } from "@pinesandbox/computer";
import { publish } from "./live";
import { session } from "./pine";

const shared = globalThis as typeof globalThis & { __demoWatching?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function watch(): void {
  if (shared.__demoWatching) return;
  shared.__demoWatching = true;
  loop().catch((error) => {
    console.error("[watch] stopped:", error);
    shared.__demoWatching = false;
  });
}

async function loop(): Promise<never> {
  let task = "";
  let cursor: string | undefined;
  for (;;) {
    const s = await session();
    if (!s) {
      await sleep(4_000);
      continue;
    }
    try {
      const { taskId } = await s.agent.status();
      if (taskId !== task) {
        task = taskId;
        cursor = undefined;
      }
      for await (const event of s.agent.events({ lastEventId: cursor, expectedTaskId: task, frames: false })) {
        cursor = String(event.eventId);
        const act = event.activity();
        if (act)
          publish({
            type: "step",
            step: { id: act.id, state: act.state, kind: act.kind, title: act.title, page: act.facts?.page?.title || act.facts?.page?.url, at: (event.ts ?? new Date()).toISOString() },
          });
        const progress = event.progress();
        if (progress?.text) publish({ type: "progress", text: progress.text });
        const control = event.controlChange();
        if (control) publish({ type: "control", controller: control.controller });
      }
    } catch (error) {
      // No task before the first run (404); a new task replaced this one (409); the sandbox went away.
      if (!(error instanceof ApiError)) console.error("[watch]", error);
      await sleep(3_000);
    }
  }
}
