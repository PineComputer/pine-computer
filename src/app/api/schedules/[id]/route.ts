import { body, route } from "@/server/http";
import { deleteSchedule, fire, setEnabled } from "@/server/schedules";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

/** Turns it on or off. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  await setEnabled(await currentUser(), id, Boolean((await body<{ enabled: boolean }>(request)).enabled));
});

/** Runs it now, starting the Computer if it must. Its next time stays as it was. */
export const POST = route<{ id: string }>(async (_request, { id }) => {
  await fire(await currentUser(), id, `now-${Date.now()}`);
});

export const DELETE = route<{ id: string }>(async (_request, { id }) => {
  await deleteSchedule(await currentUser(), id);
});
