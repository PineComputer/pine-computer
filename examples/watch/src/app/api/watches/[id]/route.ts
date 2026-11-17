// Pause or resume a watch, or delete it with its history.

import { body, route } from "@/server/http";
import { currentUser } from "@/server/user";
import { deleteWatch, setEnabled } from "@/server/watches";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const { enabled } = await body<{ enabled: boolean }>(request);
  await setEnabled(await currentUser(), id, Boolean(enabled));
});

export const DELETE = route<{ id: string }>(async (_request, { id }) => deleteWatch(await currentUser(), id));
