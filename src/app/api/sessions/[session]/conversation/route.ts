// Starts a new conversation: the session's agent forgets the last one. Its turns stay
// in this app's history.

import { route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const DELETE = route<{ session: string }>(async (_request, { session }) => {
  const agent = (await requireSession(await currentUser(), session)).agent;
  const { taskId } = await agent.status();
  return { taskId: (await agent.reset(taskId)).taskId };
});
