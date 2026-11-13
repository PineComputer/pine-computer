// A message in a thread: a job for its coworker, building on what it already did there.
// It answers at once; the job starts in the background (see src/server/jobs.ts).

import { body, required, route } from "@/server/http";
import { submit } from "@/server/jobs";

export const dynamic = "force-dynamic";

export const POST = route<{ thread: string }>(async (request, { thread }) => {
  const input = await body<{ goal?: string; key?: string }>(request);
  await submit(thread, required(input.goal, "Describe the job."), input.key ?? "");
});
