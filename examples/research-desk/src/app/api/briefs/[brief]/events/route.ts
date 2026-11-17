// A brief as it happens, relayed to the page as server-sent events: every reader's
// public activity on one stream, each event tagged with its run. The pictures of the
// screen are left out (`frames: false`): the page shows each live screen itself.
//
// A reader that starts later (its Computer was still coming up, or it waited in the
// queue) joins the stream when its session opens.

import { ApiError } from "@pinesandbox/computer";
import { route } from "@/server/http";
import { liveName, session } from "@/server/pine";
import { read, update } from "@/server/store";
import { eventStream, sleep, sse, toWire } from "@/server/wire";

export const dynamic = "force-dynamic";

export const GET = route<{ brief: string }>(async (request, { brief }) =>
  eventStream(request, async (send, signal) => {
    const following = new Set<string>();

    const followRun = async (run: string) => {
      const target = await session(run);
      if (!target) return;
      // No task until the run is admitted: look again shortly.
      let task = "";
      while (!task && !signal.aborted) {
        try {
          ({ taskId: task } = await target.agent.status({ signal }));
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
          await sleep(1_500, signal);
        }
      }
      for await (const event of target.agent.events({ expectedTaskId: task, frames: false, signal })) {
        const wire = toWire(run, event);
        if (!wire) continue;
        send(sse(wire));
        // The Computer hands the controls back by itself when a person sits idle: keep
        // the desk's picture of who drives true.
        if (wire.controller) await noteDriver(run, wire.controller === "human");
      }
    };

    while (!signal.aborted) {
      const data = await read();
      for (const run of data.runs) {
        const name = run.brief === brief ? liveName(data, run.id) : null;
        if (!name || following.has(name)) continue;
        following.add(name);
        // A session that ends (its reader moved on, or its Computer stopped) ends its part of the stream.
        void followRun(run.id).catch(() => undefined);
      }
      await sleep(2_000, signal);
    }
  }),
);

async function noteDriver(run: string, human: boolean): Promise<void> {
  const reader = (await read()).readers.find((r) => r.session?.run === run);
  if (!reader || Boolean(reader.driving) === human) return;
  await update((data) => {
    const found = data.readers.find((r) => r.session?.run === run);
    if (found) found.driving = human || undefined;
  });
}
