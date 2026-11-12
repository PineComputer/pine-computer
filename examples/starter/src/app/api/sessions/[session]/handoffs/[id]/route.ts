// One period when a person drove the session: when, and the page it ended on.

import type { HandoffView } from "@/shared/api";
import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route<{ session: string; id: string }>(async (_request, { session, id }): Promise<HandoffView> => {
  const handoff = await (await requireSession(await currentUser(), session)).getHandoff(id);
  const url = handoff.raw.current_url;
  return {
    id: handoff.handoffId,
    startedAt: handoff.startedAt?.toISOString(),
    endedAt: handoff.endedAt?.toISOString(),
    url: typeof url === "string" && url ? url : undefined,
  };
});
