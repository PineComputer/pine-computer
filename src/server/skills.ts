import type { SkillVersionView } from "@/shared/api";

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** A learned-skill version as the Computer reports it, for the page. */
export const versionView = (v: Raw): SkillVersionView => ({
  name: String(v.name),
  version: Number(v.version),
  status: String(v.status),
  createdAt: String(v.created_at ?? ""),
  activatedAt: str(v.activated_at),
  reason: str(v.reason),
  origin: str(v.origin),
  tainted: v.tainted === true,
  body: str(v.body),
});
