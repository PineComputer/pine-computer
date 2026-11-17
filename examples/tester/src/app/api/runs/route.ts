// Starts a run: a target and what to check, in plain words. The page makes the run's
// key, so a request sent twice starts one run.

import { body, required, route } from "@/server/http";
import { submit } from "@/server/runs";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { key, target, checks } = await body<{ key: string; target?: string; checks?: string }>(request);
  await submit(key, required(target, "Give the address of the app to test."), required(checks, "Say what to check."));
  return { id: key };
});
