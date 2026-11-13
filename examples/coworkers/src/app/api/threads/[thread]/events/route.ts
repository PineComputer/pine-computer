// A thread as it happens, relayed to the page as server-sent events: the coworker's
// public activity (default events) and changes in who drives (`control` events). The
// pictures of the screen are left out: the live desktop is right beside the thread.
//
// Each event's id carries both cursors and the agent's Task, so the page's EventSource
// resumes both streams from where it was after a dropped connection.

import { ApiError } from "@pinesandbox/computer";
import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { update } from "@/server/store";
import { eventStream, sleep, sse, toWire, toWireControl } from "@/server/wire";

export const dynamic = "force-dynamic";

export const GET = route<{ thread: string }>(async (request, { thread }) => {
  const target = await requireSession(thread);
  const cursor = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("cursor") ?? "";
  const [savedTask = "", savedAgent = "", savedControl = ""] = cursor.split("|");
  let task = savedTask;
  let agent = savedAgent;
  let control = savedControl;
  const id = () => `${task}|${agent}|${control}`;

  return eventStream(request, async (send, signal) => {
    const agentEvents = async () => {
      while (!signal.aborted) {
        let current: string;
        try {
          ({ taskId: current } = await target.agent.status());
        } catch (error) {
          // No task until the first run: look again shortly.
          if (error instanceof ApiError && error.status === 404) {
            await sleep(2_000, signal);
            continue;
          }
          throw error;
        }
        if (current !== task) {
          task = current;
          agent = "";
          send(sse({ taskId: task }, { id: id(), event: "task" }));
        }
        try {
          for await (const event of target.agent.events({ lastEventId: agent || undefined, expectedTaskId: task, frames: false, signal })) {
            agent = String(event.eventId);
            const wire = toWire(event);
            if (wire) send(sse(wire, { id: id() }));
          }
        } catch (error) {
          // A new conversation replaced the Task: follow the new one.
          if (signal.aborted || (error instanceof ApiError && error.status === 409)) continue;
          throw error;
        }
      }
    };
    const controlEvents = async () => {
      for await (const event of target.controlEvents({ lastEventId: control || undefined, signal })) {
        control = String(event.id);
        const wire = toWireControl(event);
        send(sse(wire, { id: id(), event: "control" }));
        // The Computer hands the controls back by itself when a person sits idle: keep
        // the workspace's picture of who drives true.
        if (wire.type === "controller_changed" && wire.controller) await noteDriver(thread, wire.controller === "human");
      }
    };
    await Promise.all([agentEvents(), controlEvents()]);
  });
});

async function noteDriver(thread: string, human: boolean): Promise<void> {
  await update((data) => {
    const coworker = data.coworkers.find((c) => c.id === data.threads.find((t) => t.id === thread)?.coworker);
    if (!coworker) return;
    if (human) coworker.driving = thread;
    else if (coworker.driving === thread) delete coworker.driving;
  });
}
