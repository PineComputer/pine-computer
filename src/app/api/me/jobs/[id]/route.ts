import { HttpError, route } from "@/server/http";
import { visitor } from "@/server/visitor";
import { episode } from "@/engine/episodes";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (request, { id }) => {
  const me = visitor(request);
  const found = episode(id);
  if (!found || found.resident_id !== me.id) throw new HttpError(404, "There's no such job.");
  return { id: found.id, state: found.state, summary: found.summary, cost: found.cost, files: JSON.parse(found.results).map((r: { detail: string }) => r.detail), error: found.error };
});
