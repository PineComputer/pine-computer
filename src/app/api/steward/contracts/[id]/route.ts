import { body, HttpError, route } from "@/server/http";
import { resolve } from "@/engine/market";

export const dynamic = "force-dynamic";

/** A steward settles a disputed contract, for the seller or the buyer. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const { to } = await body<{ to: string }>(request);
  if (to !== "seller" && to !== "buyer") throw new HttpError(400, "Settle to the seller or the buyer.");
  resolve(id, to === "seller");
});
