// Turns work into a skill the agent can reuse: learn from its last finished task, teach
// it from what a person just showed it, or refine a version with guidance. Authoring
// runs on its own model for a minute or three; the page follows it at
// /author/[authorId], and the draft waits for review in Skills.

import type { AuthorRun } from "@pinesandbox/computer";
import { body, HttpError, required, route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string }>(async (request, { session }) => {
  const input = await body<{ kind: string; goal?: string; handoffId?: string; clarifications?: string; skill?: string; version?: number; guidance?: string }>(request);
  const target = await requireSession(await currentUser(), session);
  let run: AuthorRun;
  switch (input.kind) {
    case "learn":
      run = await target.startLearn();
      break;
    case "teach":
      run = await target.startTeach(required(input.goal, "Say what you showed it."), {
        handoffId: input.handoffId || undefined,
        clarifications: input.clarifications?.trim() || undefined,
      });
      break;
    case "refine":
      if (!input.skill || !Number.isInteger(input.version)) throw new HttpError(400, "Choose the version to refine.");
      run = await target.startRefine(input.skill, input.version!, required(input.guidance, "Say what to change."));
      break;
    default:
      throw new HttpError(400, "Choose learn, teach or refine.");
  }
  return { authorId: run.authorId, handoffId: run.handoffId };
});
