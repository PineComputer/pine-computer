// A file from the session's work directory, as it is now, streamed through.

import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";
import { download } from "@/server/download";

export const dynamic = "force-dynamic";

export const GET = route<{ session: string; path: string[] }>(async (_request, { session, path }) => {
  // Next decodes each segment already.
  const relative = path.join("/");
  return download(relative, await (await requireSession(await currentUser(), session)).openFile(relative));
});
