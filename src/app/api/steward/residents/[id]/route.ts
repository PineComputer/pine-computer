import { body, HttpError, route } from "@/server/http";
import { now, run } from "@/engine/db";
import { record } from "@/engine/record";
import { requireResident, setStatus } from "@/engine/residents";

export const dynamic = "force-dynamic";

/** Freeze, unfreeze, or wake now. Every steward act is in the record. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const r = requireResident(id);
  const { action } = await body<{ action: string }>(request);
  if (action === "freeze") setStatus(r.id, "frozen");
  else if (action === "unfreeze") setStatus(r.id, "active");
  else if (action === "wake") run("update residents set next_wake_at = ? where id = ?", now(), r.id);
  else throw new HttpError(400, "Choose freeze, unfreeze or wake.");
  record("steward", `steward-${action}`, `A steward chose to ${action} ${r.name}.`, { subject: r.id });
});
