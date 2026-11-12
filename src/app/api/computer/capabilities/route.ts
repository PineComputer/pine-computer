// What this Computer can do in its current sandbox, and the limits it applies.

import { route } from "@/server/http";
import { capabilities } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route(async () => capabilities(await currentUser()));
