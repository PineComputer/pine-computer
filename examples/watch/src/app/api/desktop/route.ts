// A connection the page can open to watch, or drive, the Computer's desktop during a
// check. It holds a desktop token that expires in two minutes, and never the project
// key, the Computer's credentials or the session token. The page asks again on every connect.

import { HttpError, route } from "@/server/http";
import { computer, DESK } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const found = await computer(await currentUser());
  if (!found) throw new HttpError(409, "The Computer is stopped.");
  return found.delegateDesktop(DESK, { create: false });
});
