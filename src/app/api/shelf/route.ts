import { route } from "@/server/http";
import { shelf } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async () => shelf(200));
