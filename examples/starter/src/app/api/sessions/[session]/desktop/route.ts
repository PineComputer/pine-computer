// A connection the page can open to watch, or drive, the session's desktop. It holds a
// desktop token that expires in two minutes, and never the project key, the Computer's
// credentials or the session token. The page asks again on every connect.

import { route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (_request, { session }) =>
  (await requireComputer(await currentUser())).delegateDesktop(session, { create: false }),
);
