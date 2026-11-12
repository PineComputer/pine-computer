// The page's picture of the user's Computer: its state, its sessions, and the turns
// this app kept. The page reads it again whenever /api/live says something changed.

import type { AppState } from "@/shared/api";
import { route } from "@/server/http";
import { capabilities, computer, overview, released } from "@/server/pine";
import { readUser } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

const LIVE = new Set(["running", "canceling"]);

export const GET = route(async (): Promise<AppState> => {
  const user = await currentUser();
  const view = await overview(user);
  // It stopped by itself (idle, or from elsewhere): its sessions closed with it.
  if (view?.state === "stopped" && (await readUser(user)).computer?.binding) await released(user);
  const data = await readUser(user);
  const running = view?.state === "running";
  const [sessionLimit, drafts] = running
    ? await Promise.all([
        capabilities(user).then((c) => c.sessions, () => 3),
        computer(user).then((c) => c?.skills.drafts() ?? [], () => []).then((d) => d.length),
      ])
    : [3, 0];
  return {
    computer: view,
    sessions: data.sessions.map((s) => {
      const turns = data.turns.filter((t) => t.session === s.name);
      return {
        name: s.name,
        label: s.label,
        createdAt: s.createdAt,
        open: running && Boolean(s.token) && s.bindingRevision === data.computer?.bindingRevision,
        working: turns.some((t) => LIVE.has(t.state)),
        waiting: turns.at(-1)?.state === "needs_input",
      };
    }),
    turns: data.turns.map(({ runKey: _key, ...turn }) => turn),
    sessionLimit,
    drafts,
    ownAgent: Boolean(process.env.ANTHROPIC_API_KEY),
  };
});
