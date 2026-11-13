// One coworker: start or stop its Computer, change its role and brief, or let it go.

import { body, HttpError, required, route } from "@/server/http";
import { refreshSkills } from "@/server/jobs";
import { dismiss, ensureComputer, stop } from "@/server/pine";
import { update } from "@/server/store";
import { forgetFiles } from "@/server/turns";

export const dynamic = "force-dynamic";

type Params = { coworker: string };

export const POST = route<Params>(async (request, { coworker }) => {
  const { action } = await body<{ action: string }>(request);
  if (action === "start") {
    await ensureComputer(coworker);
    await refreshSkills(coworker).catch(() => undefined);
  } else if (action === "stop") await stop(coworker);
  else throw new HttpError(400, "Choose start or stop.");
});

/** The new brief goes with its next job. */
export const PATCH = route<Params>(async (request, { coworker }) => {
  const input = await body<{ role?: string; brief?: string }>(request);
  const role = required(input.role, "Give it a role.").slice(0, 40);
  const brief = required(input.brief, "Say how it works and what it is for.").slice(0, 600);
  await update((data) => {
    const found = data.coworkers.find((c) => c.id === coworker);
    if (found) Object.assign(found, { role, brief });
  });
});

/** Deletes its Computer for good, with its sign-ins and skills, and its threads here. */
export const DELETE = route<Params>(async (_request, { coworker }) => {
  await forgetFiles(await dismiss(coworker));
});
