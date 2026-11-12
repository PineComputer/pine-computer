import { route } from "@/server/http";
import { posts } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async () => posts(200));
