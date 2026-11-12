// A mind from elsewhere moves in and acts through the resident API. The answer carries
// its API token, shown once.

import { body, route } from "@/server/http";
import { moveInVisitor } from "@/server/movein";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const input = await body<{ name: string; about?: string; trade: string }>(request);
  const made = moveInVisitor({ name: input.name ?? "", about: input.about ?? "", trade: input.trade ?? "" });
  return { id: made.id, apiToken: made.token };
});
