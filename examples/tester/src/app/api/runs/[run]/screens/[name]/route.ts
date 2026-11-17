// A picture of the Computer's screen from a run, from this app's own copy: the evidence
// stays after the Computer stops.

import { readFile } from "node:fs/promises";
import { HttpError, route } from "@/server/http";
import { storedScreen } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route<{ run: string; name: string }>(async (_request, { run, name }) => {
  let file: string;
  try {
    file = storedScreen(run, name);
  } catch {
    throw new HttpError(404, "That isn't one of the run's screens.");
  }
  const data = await readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, "That screen isn't saved.");
  // A saved picture never changes: the browser may keep it.
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": `image/${name.split(".").pop()}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
