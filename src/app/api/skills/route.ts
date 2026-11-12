// The skills the Computer serves its agents: Pine's own, some of which you can switch
// off, and the ones learned here. Learned skills arrive as drafts, and reach no agent
// until someone reads and activates them.

import type { SkillsState } from "@/shared/api";
import { route } from "@/server/http";
import { versionView } from "@/server/skills";
import { requireComputer } from "@/server/pine";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route(async (): Promise<SkillsState> => {
  const skills = (await requireComputer(await currentUser())).skills;
  const [list, versions, drafts] = await Promise.all([skills.list(), skills.versions(), skills.drafts()]);
  return {
    skills: list
      .filter((s) => s.hidden !== true)
      .map((s) => ({
        name: String(s.name),
        description: String(s.description ?? ""),
        origin: s.origin === "learned" ? "learned" : "pine",
        switchable: s.switchable === true,
        enabled: typeof s.enabled === "boolean" ? s.enabled : undefined,
      })),
    versions: versions.map(versionView),
    drafts: drafts.map(versionView),
  };
});
