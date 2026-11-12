import { route } from "@/server/http";
import { recordView } from "@/engine/views";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || undefined;
  return recordView(after, 300);
});
