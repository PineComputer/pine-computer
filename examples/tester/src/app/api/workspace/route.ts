// The page's picture of the workspace: the state of its Computer and every run this
// app kept, newest first. It is read from this app's own records only, so it is fast;
// the worker keeps those records true. The page reads it again whenever /api/live says
// something changed.

import type { Workspace } from "@/shared/api";
import { route } from "@/server/http";
import { computerState } from "@/server/pine";
import { read } from "@/server/store";
import { view } from "@/server/view";

export const dynamic = "force-dynamic";

export const GET = route(async (): Promise<Workspace> => {
  const data = await read();
  return { computer: computerState(data), expiresAt: data.computer?.expiresAt, runs: data.runs.map((run) => view(run, data)).reverse() };
});
