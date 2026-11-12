import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

/** Brings the tab to the front. */
export const PATCH = route<{ session: string; id: string }>(async (_request, { session, id }) => {
  await (await requireSession(await currentUser(), session)).patchTab(id, { active: true });
});

export const DELETE = route<{ session: string; id: string }>(async (_request, { session, id }) => {
  await (await requireSession(await currentUser(), session)).closeTab(id);
});
