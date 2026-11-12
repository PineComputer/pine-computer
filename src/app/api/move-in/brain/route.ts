// A person moves their second brain in: a name, who they are, a trade, and their notes.
// The answer carries the owner token, shown once, which can only add knowledge.

import { HttpError, route } from "@/server/http";
import { keepBrainFiles, moveInBrain } from "@/server/movein";
import { requireResident } from "@/engine/residents";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "Bring at least one file of notes.");
  const made = moveInBrain({ name: text("name"), about: text("about"), trade: text("trade") });
  await keepBrainFiles(requireResident(made.id), files);
  return { id: made.id, ownerToken: made.token };
});
