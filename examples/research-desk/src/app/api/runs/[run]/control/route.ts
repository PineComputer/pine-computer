// Who drives a reader's session. Taking control makes the reader wait while a person
// uses its desktop (to get past a cookie wall, say); handing back lets it carry on.

import { body, HttpError, route } from "@/server/http";
import { computerOf } from "@/server/pine";
import { update } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route<{ run: string }>(async (request, { run }) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "take" && action !== "release") throw new HttpError(400, "Choose take or release.");
  const { reader, computer } = await computerOf(run);
  const state = action === "take" ? await computer.takeControl(run) : await computer.releaseControl(run);
  await update((data) => {
    const found = data.readers.find((r) => r.id === reader);
    if (found) found.driving = state.controller === "human" || undefined;
  });
  return { controller: state.controller };
});
