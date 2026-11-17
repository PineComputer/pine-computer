// The page's picture of the desk: the watches with their checks, and the Computer's
// state. The page reads it again whenever /api/live says something changed.

import type { AppState, CheckView } from "@/shared/api";
import { liveCheck } from "@/server/checks";
import { route } from "@/server/http";
import { readUser, type CheckRecord } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

const view = ({ runKey: _key, turnId: _turn, screen, ...check }: CheckRecord): CheckView => ({ ...check, hasScreen: Boolean(screen) });

export const GET = route(async (): Promise<AppState> => {
  const data = await readUser(await currentUser());
  return {
    watches: data.watches.map(({ retryAt: _retry, ...watch }) => ({
      ...watch,
      checks: data.checks.filter((c) => c.watchId === watch.id).map(view).reverse(),
    })),
    computer: data.computer?.state ?? "none",
    live: liveCheck(data)?.id,
    driving: Boolean(data.computer?.driving),
  };
});
