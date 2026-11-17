// A reader's Computer stops itself when it has sat idle; this stops it now.

import { body, HttpError, route } from "@/server/http";
import { stop } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route<{ reader: string }>(async (request, { reader }) => {
  const { action } = await body<{ action?: string }>(request);
  if (action !== "stop") throw new HttpError(400, "Choose stop.");
  await stop(reader);
});
