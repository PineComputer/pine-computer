// The passkeys the Computer holds for sites (their private keys never leave it), and
// the sites waiting for someone to approve a new one.

import type { PasskeyView } from "@/shared/api";
import { route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const found = await requireComputer(await currentUser());
  const [passkeys, pending] = await Promise.all([found.listPasskeys(), found.pendingPasskeyCeremonies()]);
  return {
    passkeys: passkeys.map(
      (p): PasskeyView => ({ id: p.id, rpId: p.rpId, userName: p.userDisplayName || p.userName, createdAt: p.createdAt?.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() }),
    ),
    pending: pending.map((c) => ({ id: c.id, rpId: c.rpId, origin: c.origin, userName: c.userDisplayName || c.userName, session: c.session, expiresAt: c.expiresAt?.toISOString() })),
  };
});
