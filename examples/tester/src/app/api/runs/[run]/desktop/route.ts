// A connection the page can open to watch, or drive, the run's screen on the Computer.
// It holds a desktop token that expires in two minutes, and never the project key, the
// Computer's credentials or the session token. The page asks again on every connect.

import { HttpError, route } from "@/server/http";
import { computer } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route<{ run: string }>(async (_request, { run }) => {
  const found = await computer();
  if (!found) throw new HttpError(409, "The Computer is stopped.");
  return found.delegateDesktop(run, { create: false });
});
