// Between rehearsals: forget the claim (canceling a turn still open), clear the portal's claims, and
// optionally sign every device out of the portal for the sign-in-once beat.

import { resetClaim } from "@/server/claim";
import { body, route } from "@/server/http";
import { resetPortal } from "@/server/portal";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { signOut = false } = await body<{ signOut?: boolean }>(request);
  await resetClaim();
  await resetPortal(signOut);
});
