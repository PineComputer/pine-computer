import { route } from "@/server/http";
import { world } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async () => world());
