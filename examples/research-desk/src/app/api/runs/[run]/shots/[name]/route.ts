// A picture of a reader's screen, from this app's own copy: a source still shows the
// page as the reader saw it after the Computer has stopped.

import { readFile } from "node:fs/promises";
import { HttpError, route } from "@/server/http";
import { storedShot } from "@/server/turns";

export const dynamic = "force-dynamic";

export const GET = route<{ run: string; name: string }>(async (_request, { run, name }) => {
  let file: string;
  try {
    file = storedShot(run, name);
  } catch {
    throw new HttpError(404, "That picture isn't from this run.");
  }
  const data = await readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, "That picture isn't saved.");
  // A saved picture never changes: the browser may keep it.
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": `image/${name.split(".").pop()}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
