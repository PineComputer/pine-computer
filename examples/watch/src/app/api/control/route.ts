// Who drives the Computer. Taking the controls lets a person sign in on its screen;
// handing back lets the agent carry on.

import { body, HttpError, route } from "@/server/http";
import { control } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "take" && action !== "release") throw new HttpError(400, "Choose take or release.");
  await control(await currentUser(), action);
});
