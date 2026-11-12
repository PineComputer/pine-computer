import type { ScheduleView } from "@/shared/api";
import { body, route } from "@/server/http";
import { createSchedule } from "@/server/schedules";
import { readUser } from "@/server/store";
import { currentUser } from "@/server/user";

export const dynamic = "force-dynamic";

export const GET = route(async (): Promise<ScheduleView[]> =>
  (await readUser(await currentUser())).schedules.map(({ retryAt: _retry, ...schedule }) => schedule),
);

export const POST = route(async (request) => createSchedule(await currentUser(), await body(request)));
