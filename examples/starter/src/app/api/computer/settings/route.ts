// Where the Computer's browser reaches the internet from, and how long it may sit idle.
// Both apply at the next Start; a new idle timeout also applies now while it runs.

import { ApiError, LifecycleError } from "@pinesandbox/computer";
import { body, HttpError, route } from "@/server/http";
import { computer, overview } from "@/server/pine";
import { updateUser } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const PATCH = route(async (request) => {
  const user = await currentUser();
  const { location, idleTimeoutSeconds } = await body<{ location?: string; idleTimeoutSeconds?: number }>(request);
  if (idleTimeoutSeconds !== undefined && !(Number.isInteger(idleTimeoutSeconds) && idleTimeoutSeconds >= 60)) {
    throw new HttpError(400, "The idle timeout is whole seconds, at least a minute.");
  }
  await updateUser(user, (data) => {
    if (!data.computer) throw new HttpError(409, "Create a Computer first.");
    if (location !== undefined) data.computer.location = location || undefined;
    if (idleTimeoutSeconds !== undefined) data.computer.idleTimeoutSeconds = idleTimeoutSeconds;
  });
  let appliedNow = false;
  const found = await computer(user);
  if (idleTimeoutSeconds !== undefined && found && (await overview(user))?.lifetime) {
    try {
      await found.setIdleTimeout(idleTimeoutSeconds);
      appliedNow = true;
    } catch (error) {
      // Refused for this sandbox (above what it was admitted with, say): it applies from
      // the next Start. The lifecycle API answers with a LifecycleError.
      if (!((error instanceof LifecycleError || error instanceof ApiError) && error.status < 500)) throw error;
    }
  }
  return { appliedNow, computer: await overview(user) };
});
