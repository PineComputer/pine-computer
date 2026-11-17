// The picture of the screen a check left, from this app's own files.

import { readFile } from "node:fs/promises";
import { screenFile } from "@/server/checks";
import { HttpError, route } from "@/server/http";
import { readUser } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const user = await currentUser();
  const check = (await readUser(user)).checks.find((c) => c.id === id);
  if (!check?.screen) throw new HttpError(404, "This check kept no picture.");
  // A check's picture never changes once it is kept.
  return new Response(new Uint8Array(await readFile(screenFile(user, id))), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" } });
});
