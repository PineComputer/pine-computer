// The Computer's lifecycle: create it, start and stop it, pause and resume it, recover
// a failed sandbox, or delete it for good.

import { ForbiddenError } from "@pinesandbox/computer";
import { body, HttpError, route } from "@/server/http";
import { create, destroy, overview, recover, requireComputer, start, stop } from "@/server/pine";
import { updateUser } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const user = await currentUser();
  const input = await body<{ action: string; location?: string; idleTimeoutSeconds?: number }>(request);
  switch (input.action) {
    case "create":
      await create(user, { location: input.location || undefined, idleTimeoutSeconds: input.idleTimeoutSeconds || undefined });
      break;
    case "start":
      await start(user);
      break;
    case "recover":
      await recover(user);
      break;
    case "stop":
      if (!(await stop(user))) throw new HttpError(502, "The Computer didn't confirm it stopped. Try again.");
      break;
    // Pause keeps the whole sandbox, memory and sessions included; it needs your
    // project's Pause/Resume feature.
    case "pause":
      try {
        await (await requireComputer(user)).pause();
      } catch (error) {
        // The project doesn't have it: stop offering it for this Computer.
        if (error instanceof ForbiddenError) await updateUser(user, (data) => void (data.computer && (data.computer.pauseUnavailable = true)));
        throw error;
      }
      break;
    case "resume":
      await (await requireComputer(user)).resume();
      break;
    case "delete":
      await destroy(user);
      break;
    default:
      throw new HttpError(400, "Choose create, start, stop, pause, resume, recover or delete.");
  }
  return { computer: await overview(user) };
});
