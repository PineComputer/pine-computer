// A file a job returned, from this app's own copy: it stays there after the Computer
// stops. `?open` shows it in the browser when its type is safe to show; anything else
// is always a download, so a returned page can't run as this app.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError, route } from "@/server/http";
import { download, inline } from "@/server/download";
import { storedFile } from "@/server/turns";

export const dynamic = "force-dynamic";

export const GET = route<{ job: string; path: string[] }>(async (request, { job, path }) => {
  // Next decodes each segment already.
  const relative = path.join("/");
  const file = storedFile(job, relative);
  if (!(await stat(file).catch(() => null))?.isFile()) throw new HttpError(404, "That file isn't saved yet.");
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new URL(request.url).searchParams.has("open") ? inline(relative, body) : download(relative, body);
});
