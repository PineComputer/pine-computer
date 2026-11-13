// A skill draft: read its SKILL.md, then activate it or discard it. Nothing a coworker
// learned reaches its agent until a person has read the draft and activated it.

import type { SkillDraft } from "@/shared/api";
import { body, HttpError, route } from "@/server/http";
import { decideDraft } from "@/server/jobs";
import { requireComputer } from "@/server/pine";

export const dynamic = "force-dynamic";

type Params = { coworker: string; name: string; version: string };

function number(version: string): number {
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "That's not a version.");
  return n;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const GET = route<Params>(async (_request, { coworker, name, version }): Promise<SkillDraft> => {
  const v = await (await requireComputer(coworker)).skills.version(name, number(version));
  return { name: String(v.name), version: Number(v.version), status: String(v.status), reason: str(v.reason), tainted: v.tainted === true, body: str(v.body) };
});

export const POST = route<Params>(async (request, { coworker, name, version }) => {
  const { action } = await body<{ action: string }>(request);
  if (action !== "activate" && action !== "discard") throw new HttpError(400, "Activate it, or discard it.");
  await decideDraft(coworker, name, number(version), action);
});
