import { route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

/** Deletes a passkey from the Computer. The site keeps its public half until you remove it there. */
export const DELETE = route<{ id: string }>(async (_request, { id }) => {
  await (await requireComputer(await currentUser())).deletePasskey(id);
});
