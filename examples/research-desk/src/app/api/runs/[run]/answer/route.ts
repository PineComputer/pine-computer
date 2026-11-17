// A reply to the question a reader stopped on.

import { answer } from "@/server/desk";
import { body, required, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route<{ run: string }>(async (request, { run }) => {
  const { text } = await body<{ text?: string }>(request);
  await answer(run, required(text, "Write a reply."));
});
