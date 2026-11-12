// The portal's staff view: proof that a claim the agent reports exists in the system it worked in, and the
// demo reset between rehearsals.

import "server-only";
import { PORTAL_URL } from "./config";

const key = () => process.env.PORTAL_STAFF_KEY ?? "";
export const portalStaff = () => !!key();

export async function claimExists(number: string): Promise<boolean> {
  if (!key()) return false;
  const response = await fetch(`${PORTAL_URL}/staff/api/state?key=${encodeURIComponent(key())}`, { cache: "no-store" });
  if (!response.ok) return false;
  const state = (await response.json()) as { claims: { number: string }[] };
  return state.claims.some((c) => c.number === number);
}

/** Clears the portal's claims and drafts; `signOut` also signs every device out, for the sign-in-once beat. */
export async function resetPortal(signOut = false): Promise<void> {
  if (!key()) return;
  for (const action of signOut ? ["reset", "signout"] : ["reset"])
    await fetch(`${PORTAL_URL}/staff/${action}?key=${encodeURIComponent(key())}`, { method: "POST", redirect: "manual" });
}
