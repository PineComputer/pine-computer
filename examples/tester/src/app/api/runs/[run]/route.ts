// Acts on one run: approve or decline the step it stopped at, reply to its question,
// stop it, take the controls or hand them back. DELETE forgets a finished run.

import { body, HttpError, required, route } from "@/server/http";
import { control } from "@/server/control";
import { answer, cancel, remove } from "@/server/runs";

export const dynamic = "force-dynamic";

export const POST = route<{ run: string }>(async (request, { run }) => {
  const { action, text } = await body<{ action: string; text?: string }>(request);
  switch (action) {
    case "approve":
    case "decline":
      return answer(run, action);
    case "answer":
      return answer(run, required(text, "Write a reply."));
    case "cancel":
      return cancel(run);
    case "take":
    case "release":
      return control(run, action);
    default:
      throw new HttpError(400, "Choose approve, decline, answer, cancel, take or release.");
  }
});

export const DELETE = route<{ run: string }>(async (_request, { run }) => remove(run));
