// The vault: names and notes only ever leave the server, never values.

import { body, route } from "@/server/http";
import { currentUser } from "@/server/user";
import { listSecrets, setSecret } from "@/server/vault";

export const dynamic = "force-dynamic";

export const GET = route(async () => listSecrets(await currentUser()));

export const POST = route(async (request) => {
  const user = await currentUser();
  await setSecret(user, await body(request));
  return listSecrets(user);
});
