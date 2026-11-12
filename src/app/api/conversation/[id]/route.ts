import { route } from "@/server/http";
import { endConversation } from "@/server/tavus";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async (_request, { id }) => {
  await endConversation(id);
});
