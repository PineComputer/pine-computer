// Stops the Computer now, rather than when it has sat idle. Its next run starts it
// again from what it saved.

import { body, HttpError, route } from "@/server/http";
import { stop } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "stop") throw new HttpError(400, "Choose stop.");
  await stop();
});
