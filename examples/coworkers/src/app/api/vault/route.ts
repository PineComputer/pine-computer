// The vault: names and notes only ever leave the server, never values.

import { body, route } from "@/server/http";
import { listSecrets, setSecret } from "@/server/vault";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  await setSecret(await body(request));
  return listSecrets();
});
