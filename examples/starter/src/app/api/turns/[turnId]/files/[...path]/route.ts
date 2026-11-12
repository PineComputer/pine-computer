// A file a turn returned, from this app's own copy: it stays downloadable after the
// Computer stops.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError, route } from "@/server/http";
import { download } from "@/server/download";
import { storedFile } from "@/server/turns";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route<{ turnId: string; path: string[] }>(async (_request, { turnId, path }) => {
  // Next decodes each segment already.
  const relative = path.join("/");
  const file = storedFile(await currentUser(), turnId, relative);
  if (!(await stat(file).catch(() => null))?.isFile()) throw new HttpError(404, "That file isn't saved yet.");
  return download(relative, Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
});
