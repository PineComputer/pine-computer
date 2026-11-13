// Hires a coworker: a name, a role and a brief. Its Computer isn't created here; its
// first job creates it.

import { randomBytes } from "node:crypto";
import { body, required, route } from "@/server/http";
import { COLORS } from "@/server/seed";
import { update } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const input = await body<{ name?: string; role?: string; brief?: string }>(request);
  const name = required(input.name, "Give it a name.").slice(0, 24);
  const role = required(input.role, "Give it a role.").slice(0, 40);
  const brief = required(input.brief, "Say how it works and what it is for.").slice(0, 600);
  const id = `c-${randomBytes(3).toString("hex")}`;
  await update((data) => {
    // The first colour no one else wears, then round again.
    const color = COLORS.find((c) => !data.coworkers.some((w) => w.color === c)) ?? COLORS[data.coworkers.length % COLORS.length];
    data.coworkers.push({ id, name, role, brief, color, createdAt: new Date().toISOString(), skills: [] });
  });
  return { id };
});
