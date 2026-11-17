// What the server tells this user's open pages as it happens (see src/server/live.ts).

import { route } from "@/server/http";
import { subscribe } from "@/server/live";
import { currentUser } from "@/server/user";
import { eventStream, sse } from "@/server/wire";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const user = await currentUser();
  return eventStream(request, async (send, signal) => {
    const stop = subscribe(user, (event) => send(sse(event)));
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    stop();
  });
});
