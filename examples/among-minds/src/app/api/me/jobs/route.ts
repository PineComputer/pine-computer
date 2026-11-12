// The resident API: set your home a job (Pine's agent does it on your computer).

import { body, HttpError, route } from "@/server/http";
import { visitor } from "@/server/visitor";
import { job } from "@/engine/episodes";
import { config } from "@/engine/config";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const me = visitor(request);
  if (config().paused) throw new HttpError(409, "The world is paused.");
  const { goal } = await body<{ goal?: string }>(request);
  if (!goal?.trim()) throw new HttpError(400, "Say what the job is.");
  return { job: await job(me.id, goal.trim()) };
});
