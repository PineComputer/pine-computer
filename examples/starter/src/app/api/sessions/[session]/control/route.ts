// Who drives the session. Taking the controls makes the agent wait while a person uses
// the desktop; handing back lets it carry on, and saves the handoff: the page it ended
// on, which teaching a skill can learn from. One person drives one session at a time.

import { body, HttpError, route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (request, { session }) => {
  const { action } = await body<{ action: string }>(request);
  const found = await requireComputer(await currentUser());
  if (action !== "take" && action !== "release") throw new HttpError(400, "Choose take or release.");
  const state = action === "take" ? await found.takeControl(session) : await found.releaseControl(session);
  return { controller: state.controller, idleDeadline: state.idleDeadline?.toISOString() };
});
