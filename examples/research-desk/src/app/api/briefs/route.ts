// A question becomes a brief. The page makes the key, so a request sent twice asks once.

import { ask } from "@/server/desk";
import { body, required, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { question, key } = await body<{ question?: string; key?: string }>(request);
  return { id: await ask(required(question, "Ask a question.").slice(0, 600), key ?? "") };
});
