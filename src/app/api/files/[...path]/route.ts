// A file the claim's turn returned, copied out of the Computer when the turn ended.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError, route } from "@/server/http";
import { DATA_DIR } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route<{ path: string[] }>(async (_request, { path: parts }) => {
  const root = path.join(DATA_DIR, "files");
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) throw new HttpError(404, "Not found.");
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) throw new HttpError(404, "Not found.");
  const name = path.basename(file);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
  });
});
