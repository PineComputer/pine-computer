// A person takes the controls (the agent waits) and hands them back (it carries on).

import { body, HttpError, route } from "@/server/http";
import { computer, SESSION } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { action } = await body<{ action: string }>(request);
  const found = await computer();
  if (!found) throw new HttpError(409, "Prepare the Computer first.");
  if (action !== "take" && action !== "release") throw new HttpError(400, "Choose take or release.");
  const state = action === "take" ? await found.takeControl(SESSION) : await found.releaseControl(SESSION);
  return { controller: state.controller };
});
