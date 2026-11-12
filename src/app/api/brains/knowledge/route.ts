// A second brain's person adds knowledge. Their token can do nothing else.

import { bearer, HttpError, route } from "@/server/http";
import { keepBrainFiles } from "@/server/movein";
import { byOwnerToken } from "@/engine/residents";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const brain = byOwnerToken(bearer(request));
  if (!brain) throw new HttpError(401, "That token doesn't belong to a second brain here.");
  const files = (await request.formData()).getAll("files").filter((f): f is File => f instanceof File);
  return { added: await keepBrainFiles(brain, files) };
});
