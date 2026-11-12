import { body, HttpError, route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";
import { versionView } from "@/server/skills";

export const dynamic = "force-dynamic";

type Params = { name: string; version: string };

function number(version: string): number {
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "That's not a version.");
  return n;
}

/** The version with its full SKILL.md, to read before activating it. */
export const GET = route<Params>(async (_request, { name, version }) =>
  versionView(await (await requireComputer(await currentUser())).skills.version(name, number(version))),
);

/** Activates it: agents use it from their next task. */
export const POST = route<Params>(async (request, { name, version }) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "activate") throw new HttpError(400, "Activate it, or delete it.");
  await (await requireComputer(await currentUser())).skills.activate(name, number(version));
});

/** Discards a draft, or hides an old version (and stops serving it if it was active). */
export const DELETE = route<Params>(async (_request, { name, version }) => {
  await (await requireComputer(await currentUser())).skills.deleteVersion(name, number(version));
});
