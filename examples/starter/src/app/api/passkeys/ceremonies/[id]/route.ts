// A site asked to create a passkey. Approving lets the Computer create and keep it; the
// site sees a passkey like any other. Declining tells the site it failed.

import { body, HttpError, route } from "@/server/http";
import { publish } from "@/server/live";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await currentUser();
  const found = await requireComputer(user);
  const { decision } = await body<{ decision: string }>(request);
  if (decision === "approve") await found.approvePasskeyCeremony(id);
  else if (decision === "decline") await found.declinePasskeyCeremony(id);
  else throw new HttpError(400, "Approve or decline.");
  const pending = await found.pendingPasskeyCeremonies();
  publish(user, {
    type: "passkeys",
    ceremonies: pending.map((c) => ({ id: c.id, rpId: c.rpId, origin: c.origin, userName: c.userDisplayName || c.userName, session: c.session, expiresAt: c.expiresAt?.toISOString() })),
  });
});
