// Asks Pine to check the Computer: a read-only look at its sandbox (and a session's
// recorded work) that comes back with what's wrong and what to do.

import { body, HttpError, route } from "@/server/http";
import { client } from "@/server/pine";
import { readUser } from "@/server/store";
import { currentUser } from "@/server/user";
import { diagnosticView } from "./view";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const user = await currentUser();
  const saved = (await readUser(user)).computer;
  if (!saved) throw new HttpError(409, "Create a Computer first.");
  const { session, description } = await body<{ session?: string; description?: string }>(request);
  return diagnosticView(
    await client().createDiagnostic({ computerId: saved.id, session: session || undefined, description: description?.trim() || undefined }),
  );
});
