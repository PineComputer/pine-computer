// The session's browser tabs, and opening a page in a new one.

import type { Tab } from "@pinesandbox/computer";
import type { TabView } from "@/shared/api";
import { body, HttpError, required, route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

const view = (tab: Tab): TabView => ({ id: tab.targetId, url: tab.url, title: tab.title || tab.label, active: tab.active });

export const GET = route<{ session: string }>(async (_request, { session }) =>
  (await (await requireSession(await currentUser(), session)).listTabs()).map(view),
);

export const POST = route<{ session: string }>(async (request, { session }) => {
  let url = required((await body<{ url?: string }>(request)).url, "Type an address.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url)) throw new HttpError(400, "Open a web address: http or https.");
  const target = await requireSession(await currentUser(), session);
  // A page someone asked to open is the one they want to see.
  const tab = await target.createTab(url);
  return view(await target.patchTab(tab.targetId, { active: true }));
});
