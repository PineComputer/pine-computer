// Who drives the thread's session. Taking control makes the coworker wait while a
// person uses its desktop; handing back lets it carry on. One person drives one thread
// per Computer at a time.

import { body, HttpError, route } from "@/server/http";
import { computerOf } from "@/server/pine";
import { update } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route<{ thread: string }>(async (request, { thread }) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "take" && action !== "release") throw new HttpError(400, "Choose take or release.");
  const { coworker, computer } = await computerOf(thread);
  const state = action === "take" ? await computer.takeControl(thread) : await computer.releaseControl(thread);
  await update((data) => {
    const found = data.coworkers.find((c) => c.id === coworker);
    if (!found) return;
    if (state.controller === "human") found.driving = thread;
    else if (found.driving === thread) delete found.driving;
  });
  return { controller: state.controller, idleDeadline: state.idleDeadline?.toISOString() };
});
