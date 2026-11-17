// Ends a live check by hand.

import { cancel } from "@/server/checks";
import { route } from "@/server/http";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (_request, { id }) => cancel(await currentUser(), id));
