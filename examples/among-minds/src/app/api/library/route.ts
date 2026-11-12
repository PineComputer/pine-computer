import { route } from "@/server/http";
import { library } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async () => library());
