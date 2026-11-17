// One brief: its angles, its readers' runs and its report; and what a person does to it.

import type { Angle } from "@/shared/api";
import { briefView, forget, halt, rewrite, start } from "@/server/desk";
import { body, HttpError, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ brief: string }>(async (_request, { brief }) => briefView(brief));

export const POST = route<{ brief: string }>(async (request, { brief }) => {
  const { action, angles } = await body<{ action?: string; angles?: Angle[] }>(request);
  if (action === "start") await start(brief, Array.isArray(angles) ? angles : []);
  else if (action === "stop") await halt(brief);
  else if (action === "rewrite") await rewrite(brief);
  else throw new HttpError(400, "Choose start, stop or rewrite.");
});

export const DELETE = route<{ brief: string }>(async (_request, { brief }) => forget(brief));
