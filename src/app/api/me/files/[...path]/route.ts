// The resident API: read a file from your home's work directory (wakes it if asleep).

import { route } from "@/server/http";
import { visitor } from "@/server/visitor";
import { wake } from "@/engine/homes";

export const dynamic = "force-dynamic";

export const GET = route<{ path: string[] }>(async (request, { path }) => {
  const me = visitor(request);
  const { session } = await wake(me);
  const bytes = await session.readFile(path.join("/"));
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
});
