// A steward releases a native resident.

import { body, route } from "@/server/http";
import { moveIn } from "@/engine/residents";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const input = await body<{ name: string; trade: string; temperament?: string; persona?: string }>(request);
  return moveIn({ name: input.name ?? "", kind: "native", trade: input.trade ?? "", temperament: input.temperament, persona: input.persona });
});
