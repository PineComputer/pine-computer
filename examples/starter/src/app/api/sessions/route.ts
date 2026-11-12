// A new session beside the others: its own browser window, shell, work directory and
// agent. Sessions share the Computer's sign-ins and skills, and run at the same time.

import { body, route } from "@/server/http";
import { addSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { label } = await body<{ label?: string }>(request);
  return { name: await addSession(await currentUser(), label?.trim() || "New session") };
});
