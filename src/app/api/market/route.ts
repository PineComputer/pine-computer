import { route } from "@/server/http";
import { marketView } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async () => marketView());
