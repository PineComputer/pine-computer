import { body, route } from "@/server/http";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

/** One skill with its SKILL.md. */
export const GET = route<{ name: string }>(async (_request, { name }) => (await requireComputer(await currentUser())).skills.get(name));

/** Switches one of Pine's skills on or off for the agents the Computer starts next. */
export const PUT = route<{ name: string }>(async (request, { name }) => {
  const { enabled } = await body<{ enabled: boolean }>(request);
  await (await requireComputer(await currentUser())).skills.setEnabled(name, Boolean(enabled));
});

/** Stops serving a learned skill; its versions stay. */
export const DELETE = route<{ name: string }>(async (_request, { name }) => {
  await (await requireComputer(await currentUser())).skills.deactivate(name);
});
