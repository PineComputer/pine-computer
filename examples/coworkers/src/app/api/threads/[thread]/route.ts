// Closes a thread: its session on the coworker's Computer goes (browser, shell and work
// directory), and its history here with it.

import { route } from "@/server/http";
import { computer, session } from "@/server/pine";
import { read, update } from "@/server/store";
import { forgetFiles } from "@/server/turns";

export const dynamic = "force-dynamic";

export const DELETE = route<{ thread: string }>(async (_request, { thread }) => {
  const saved = (await read()).threads.find((t) => t.id === thread);
  if (!saved) return;
  if (await session(thread)) await (await computer(saved.coworker))?.destroySession(thread, { clean: true });
  const jobs = await update((data) => {
    const ids = data.jobs.filter((j) => j.thread === thread).map((j) => j.id);
    data.threads = data.threads.filter((t) => t.id !== thread);
    data.jobs = data.jobs.filter((j) => j.thread !== thread);
    for (const coworker of data.coworkers) if (coworker.driving === thread) delete coworker.driving;
    return ids;
  });
  await forgetFiles(jobs);
});
