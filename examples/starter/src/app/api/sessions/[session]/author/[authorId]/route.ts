// An authoring run as it happens, relayed as server-sent events; it ends with the
// result: a draft, questions to answer, or why it couldn't make a skill.

import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";
import { eventStream, sse, toWire } from "@/server/wire";

export const dynamic = "force-dynamic";

export const GET = route<{ session: string; authorId: string }>(async (request, { session, authorId }) => {
  const target = await requireSession(await currentUser(), session);
  const lastEventId = request.headers.get("last-event-id") ?? undefined;
  return eventStream(request, async (send, signal) => {
    for await (const event of target.authorEvents(authorId, { lastEventId, signal })) {
      const wire = toWire(event);
      if (wire) send(sse(wire, { id: String(event.eventId) }));
      if (event.type === "result") break;
    }
    // The run is over (now, or before this connection): tell the page not to reconnect.
    send(sse({}, { event: "end" }));
  });
});

export const DELETE = route<{ session: string; authorId: string }>(async (_request, { session, authorId }) => {
  await (await requireSession(await currentUser(), session)).cancelAuthor(authorId);
});
