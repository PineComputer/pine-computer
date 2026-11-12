// A connection the page opens to watch, or drive, the claims session's desktop: the Computer's address and a
// two-minute desktop token, never the project key or the Computer's credentials. Asked again on every connect.

import { HttpError, route } from "@/server/http";
import { computer, SESSION } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const found = await computer();
  if (!found) throw new HttpError(409, "Prepare the Computer first.");
  return (await found.delegateDesktop(SESSION, { create: false })).toJSON();
});
