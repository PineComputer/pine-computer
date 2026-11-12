// The session's work directory: list a folder, or attach a file for the agent. An
// attached file lands in attachments/, which the agent reads as material.

import type { WorkFile } from "@/shared/api";
import { HttpError, route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export const GET = route<{ session: string }>(async (request, { session }) => {
  const folder = new URL(request.url).searchParams.get("path") || undefined;
  const entries = await (await requireSession(await currentUser(), session)).listFiles({ path: folder });
  return entries
    .map((e): WorkFile => ({ path: e.relativePath, name: e.name, isDir: e.isDir, size: e.size, modifiedAt: e.modifiedAt?.toISOString() }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
});

export const POST = route<{ session: string }>(async (request, { session }) => {
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Attach files up to 25 MB.");
  const name = file.name.replace(/[/\\]/g, "_");
  await (await requireSession(await currentUser(), session)).writeFile(name, new Uint8Array(await file.arrayBuffer()));
  return { name, path: `attachments/${name}`, size: file.size };
});
