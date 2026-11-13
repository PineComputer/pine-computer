import path from "node:path";

const disposition = (kind: string, name: string) => `${kind}; filename="${name.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** A file as a download: always an attachment, so a returned page can't run as this app. */
export function download(name: string, body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": disposition("attachment", path.basename(name)),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/** Types a browser shows without running anything in them. */
const SHOWN: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
};

/** A file shown in the browser when its type is safe to show, and downloaded otherwise. */
export function inline(name: string, body: ReadableStream<Uint8Array>): Response {
  const type = SHOWN[path.extname(name).toLowerCase()];
  if (!type) return download(name, body);
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": disposition("inline", path.basename(name)),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
