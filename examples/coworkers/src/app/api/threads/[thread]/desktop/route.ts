// A connection the page can open to watch, or drive, the thread's desktop on its
// coworker's Computer. It holds a desktop token that expires in two minutes, and never
// the project key, the Computer's credentials or the session token. The page asks again
// on every connect.

import { route } from "@/server/http";
import { computerOf } from "@/server/pine";

export const dynamic = "force-dynamic";

export const POST = route<{ thread: string }>(async (_request, { thread }) => (await computerOf(thread)).computer.delegateDesktop(thread, { create: false }));
