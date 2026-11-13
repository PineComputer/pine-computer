// Acts on one job: answer its question (Approve and Decline are answers too), steer it
// while it runs, stop it, or draft a skill from it. Each names the job it acts on, so a
// reply meant for an earlier question can't land on a later one.

import { body, HttpError, required, route } from "@/server/http";
import { answer, cancel, learn, steer } from "@/server/jobs";

export const dynamic = "force-dynamic";

export const POST = route<{ thread: string; job: string }>(async (request, { thread, job }) => {
  const { action, text } = await body<{ action: string; text?: string }>(request);
  switch (action) {
    case "answer":
      return answer(thread, job, required(text, "Write a reply."));
    case "steer":
      return steer(thread, job, required(text, "Write what to change."));
    case "cancel":
      return cancel(thread, job);
    case "learn":
      // With `text`, the person's answers to the skill author's questions.
      return learn(thread, job, text?.trim() || undefined);
    default:
      throw new HttpError(400, "Choose answer, steer, cancel or learn.");
  }
});
