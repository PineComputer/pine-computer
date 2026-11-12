import { body, required, route } from "@/server/http";
import { closeSession } from "@/server/pine";
import { readUser, updateUser } from "@/server/store";
import { forgetFiles } from "@/server/turns";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

/** Renames it. The name is this app's: the Computer knows it by its session name. */
export const PATCH = route<{ session: string }>(async (request, { session }) => {
  const label = required((await body<{ label?: string }>(request)).label, "Name it.");
  await updateUser(await currentUser(), (data) => {
    const found = data.sessions.find((s) => s.name === session);
    if (found) found.label = label.slice(0, 40);
  });
});

/** Closes it: its browser, shell and work directory go, and its history here with them. */
export const DELETE = route<{ session: string }>(async (_request, { session }) => {
  const user = await currentUser();
  const turnIds = (await readUser(user)).turns.filter((t) => t.session === session).map((t) => t.turnId);
  await closeSession(user, session);
  await forgetFiles(user, turnIds);
});
