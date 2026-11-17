// A new watch: what to look at, where, and how often. Its first check starts at once.

import type { Cadence } from "@/shared/api";
import { body, route } from "@/server/http";
import { currentUser } from "@/server/user";
import { createWatch } from "@/server/watches";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const input = await body<{ what?: string; url?: string; cadence?: Cadence }>(request);
  return { id: (await createWatch(await currentUser(), input)).id };
});
