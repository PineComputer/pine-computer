// The person's answer to a check that asked (for a sign-in, usually). Any controls
// they took are handed back first, and the agent opens the page again, so the check keeps a picture of what it read.

import { answer } from "@/server/checks";
import { body, route } from "@/server/http";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { text } = await body<{ text?: string }>(request);
  await answer(await currentUser(), id, text?.trim() || "Done. Open the page again and carry on.");
});
