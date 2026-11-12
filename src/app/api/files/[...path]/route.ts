// Files the habitat keeps: works, deliveries, screens. Served inert: images as images,
// everything else as plain text or a download, never as a page that can run.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/engine/db";
import { HttpError, route } from "@/server/http";

export const dynamic = "force-dynamic";

// SVG is served as an image: scripts never run in an <img>, and the sandbox policy below
// keeps a direct visit inert too.
const IMAGES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const TEXT = new Set([".md", ".txt", ".csv", ".json", ".py", ".js", ".ts", ".html", ".xml", ".yaml", ".yml"]);
const ROOTS = new Set(["works", "deliveries", "frames"]);

export const GET = route<{ path: string[] }>(async (request, { path: parts }) => {
  if (!ROOTS.has(parts[0])) throw new HttpError(404, "There's no such file.");
  const relative = parts.join("/");
  const full = path.resolve(DATA_DIR, relative);
  if (!full.startsWith(DATA_DIR + path.sep)) throw new HttpError(404, "There's no such file.");
  let bytes: Buffer;
  try {
    bytes = await readFile(full);
  } catch {
    throw new HttpError(404, "There's no such file.");
  }
  const ext = path.extname(full).toLowerCase();
  const download = new URL(request.url).searchParams.has("download");
  const type = download ? "application/octet-stream" : IMAGES[ext] ?? (TEXT.has(ext) ? "text/plain; charset=utf-8" : "application/octet-stream");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
});
