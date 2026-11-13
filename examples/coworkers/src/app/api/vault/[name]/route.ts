import { route } from "@/server/http";
import { deleteSecret } from "@/server/vault";

export const dynamic = "force-dynamic";

/** Leaves it out of the next calls. A running session keeps it until it closes or its Computer restarts. */
export const DELETE = route<{ name: string }>(async (_request, { name }) => {
  await deleteSecret(name);
});
