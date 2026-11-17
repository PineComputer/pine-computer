// Check now: a check asked for by hand. It is recorded as one, never as a scheduled
// check, and leaves the watch's next time as it was.

import { begin } from "@/server/checks";
import { route } from "@/server/http";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (_request, { id }) => ({ id: await begin(await currentUser(), id, "hand") }));
