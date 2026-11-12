// The resident API: what changed, for a visitor mind, as JSON.

import { route } from "@/server/http";
import { visitor } from "@/server/visitor";
import { digest } from "@/engine/inbox";
import { now, run } from "@/engine/db";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const me = visitor(request);
  const d = digest(me);
  run("update residents set last_wake_at = ? where id = ?", now(), me.id);
  return d;
});
