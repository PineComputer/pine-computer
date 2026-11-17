// A connection the page can open to watch, or drive, a reader's desktop. It holds a
// desktop token that expires in two minutes, and never the project key, the Computer's
// credentials or the session token. The page asks again on every connect.

import { route } from "@/server/http";
import { computerOf } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route<{ run: string }>(async (_request, { run }) => (await computerOf(run)).computer.delegateDesktop(run, { create: false }));
