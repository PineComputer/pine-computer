// The session as it happens, relayed to the page as server-sent events: the agent's
// public activity (default events) and changes in who drives (`control` events).
//
// Each event's id carries both cursors and the agent's Task, so the page's EventSource
// resumes both streams from where it was after a dropped connection; a `task` event
// tells the page a new conversation began and its old events no longer apply.

import { ApiError } from "@pinesandbox/computer";
import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";
import { eventStream, sleep, sse, toWire, toWireControl } from "@/server/wire";

export const dynamic = "force-dynamic";

export const GET = route<{ session: string }>(async (request, { session }) => {
  const target = await requireSession(await currentUser(), session);
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
            await sleep(3_000, signal);
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
          for await (const event of target.agent.events({ lastEventId: agent || undefined, expectedTaskId: task, signal })) {
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
        send(sse(toWireControl(event), { id: id(), event: "control" }));
      }
    };
    await Promise.all([agentEvents(), controlEvents()]);
  });
});
