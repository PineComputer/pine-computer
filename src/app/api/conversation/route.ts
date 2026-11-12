// Starts a Tavus conversation whose context and greeting carry the claim as it stands.

import { route } from "@/server/http";
import { startConversation } from "@/server/tavus";

export const dynamic = "force-dynamic";

export const POST = route(async () => startConversation());
