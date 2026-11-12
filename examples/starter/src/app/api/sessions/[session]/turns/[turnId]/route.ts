// Acts on one turn: answer its question, steer it while it runs, or cancel it. Each
// names the turn it acts on, so a reply meant for an earlier turn can't land on a later one.

import { body, HttpError, required, route } from "@/server/http";
import { requireSession } from "@/server/pine";
import { recordAnswered, recordStarted } from "@/server/turns";
import { currentUser } from "@/server/user";
import { secretValues } from "@/server/vault";

export const dynamic = "force-dynamic";

export const POST = route<{ session: string; turnId: string }>(async (request, { session, turnId }) => {
  const user = await currentUser();
  const { action, text } = await body<{ action: string; text?: string }>(request);
  const agent = (await requireSession(user, session)).agent;
  switch (action) {
    case "answer": {
      const answer = required(text, "Write an answer.");
      // The answer opens the next turn, which carries on toward the same goal. The same
      // answer again returns that same turn.
      const opened = await agent.answer(turnId, answer, { secrets: await secretValues(user) });
      await recordAnswered(user, turnId);
      await recordStarted(user, session, opened, { kind: "answer", ask: answer });
      return { turnId: opened.turnId, state: opened.state };
    }
    case "steer":
      return { state: (await agent.steer(turnId, required(text, "Write what to change."), { secrets: await secretValues(user) })).state };
    case "cancel":
      return { state: (await agent.cancel(turnId)).state };
    default:
      throw new HttpError(400, "Choose answer, steer or cancel.");
  }
});
