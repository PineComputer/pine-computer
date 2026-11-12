// Prepare the Computer before the call (create, start or resume it, open the claims session), or stop it.

import { body, HttpError, route } from "@/server/http";
import { ensure, stop, view } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { action } = await body<{ action: string }>(request);
  if (action === "prepare") await ensure();
  else if (action === "stop") await stop();
  else throw new HttpError(400, "Choose prepare or stop.");
  return view();
});
