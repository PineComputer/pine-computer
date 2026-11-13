// A new thread with a coworker, opened by its first message. The page sends the key it
// made for the message: sending it again (after a lost response) starts nothing new.

import { body, required, route } from "@/server/http";
import { openThread } from "@/server/jobs";

export const dynamic = "force-dynamic";

export const POST = route<{ coworker: string }>(async (request, { coworker }) => {
  const input = await body<{ goal?: string; key?: string }>(request);
  return { thread: await openThread(coworker, required(input.goal, "Describe the job."), input.key ?? "") };
});
