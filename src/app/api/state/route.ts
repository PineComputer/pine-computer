import { route } from "@/server/http";
import { snapshot } from "@/server/snapshot";

export const dynamic = "force-dynamic";

export const GET = route(async () => snapshot());
