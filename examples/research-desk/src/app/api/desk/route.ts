// The desk: its briefs, newest first, and its three readers.

import { desk } from "@/server/desk";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => desk());
