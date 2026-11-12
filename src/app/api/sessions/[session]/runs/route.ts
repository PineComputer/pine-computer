// Gives the session's agent a task. The page sends the key it made for this message:
// sending the same key again (after a lost response, say) returns the turn it started
// instead of starting a second one. The vault goes with it, out of the model's sight.

import { body, HttpError, required, route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { recordStarted } from "@/server/turns";
import { currentUser } from "@/server/user";
import { secretValues } from "@/server/vault";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (request, { session }) => {
  const user = await currentUser();
  const input = await body<{ goal?: string; key?: string; attachments?: string[] }>(request);
  const goal = required(input.goal, "Describe a task.");
  if (!input.key) throw new HttpError(400, "Send the message's key.");
  const attachments = (input.attachments ?? []).filter((name) => typeof name === "string" && name);
  const target = await requireSession(user, session);
  const turn = await target.agent.run(goal, {
    idempotencyKey: input.key,
    secrets: await secretValues(user),
    // Files are material, not instructions: they're named in the context.
    context: attachments.length ? `Files attached for this task, in attachments/: ${attachments.join(", ")}` : undefined,
  });
  await recordStarted(user, session, turn, { kind: "run", ask: goal, runKey: input.key, attachments: attachments.length ? attachments : undefined });
  return { turnId: turn.turnId, state: turn.state };
});
