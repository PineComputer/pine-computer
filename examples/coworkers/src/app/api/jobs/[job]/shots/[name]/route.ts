// A picture of the screen from a job's trail, from this app's own copy: the trail stays
// after the Computer stops.

import { readFile } from "node:fs/promises";
import { HttpError, route } from "@/server/http";
import { storedShot } from "@/server/turns";

export const dynamic = "force-dynamic";

export const GET = route<{ job: string; name: string }>(async (_request, { job, name }) => {
  let file: string;
  try {
    file = storedShot(job, name);
  } catch {
    throw new HttpError(404, "That picture isn't in the job's trail.");
  }
  const data = await readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, "That picture isn't saved.");
  // A saved picture never changes: the browser may keep it.
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": `image/${name.split(".").pop()}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
