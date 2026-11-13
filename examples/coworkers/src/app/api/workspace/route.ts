// The page's picture of the workspace: its coworkers and the state of each one's
// Computer, their threads, and the jobs this app kept. It is read from this app's own
// records only, so it is fast; the worker keeps those records true. The page reads it
// again whenever /api/live says something changed.

import type { Status, Workspace } from "@/shared/api";
import { route } from "@/server/http";
import { computerState } from "@/server/pine";
import { read } from "@/server/store";

export const dynamic = "force-dynamic";

const WORKING = new Set(["queued", "starting", "running", "canceling"]);
const RANK: Status[] = ["idle", "working", "asking", "yours"];

export const GET = route(async (): Promise<Workspace> => {
  const data = await read();
  const threads = data.threads.map((thread) => {
    const coworker = data.coworkers.find((c) => c.id === thread.coworker);
    const jobs = data.jobs.filter((j) => j.thread === thread.id);
    const status: Status =
      coworker?.driving === thread.id ? "yours" : jobs.at(-1)?.state === "needs_input" ? "asking" : jobs.some((j) => WORKING.has(j.state)) ? "working" : "idle";
    const open = Boolean(thread.token && coworker?.computer?.binding && thread.bindingRevision === coworker.computer.bindingRevision);
    return { id: thread.id, coworker: thread.coworker, title: thread.title, createdAt: thread.createdAt, status, stream: open ? `${thread.id}:${thread.bindingRevision}` : null };
  });
  return {
    coworkers: data.coworkers.map(({ computer, ...coworker }) => ({
      ...coworker,
      // The busiest of its threads is how the coworker reads in the sidebar.
      status: threads.filter((t) => t.coworker === coworker.id).reduce<Status>((top, t) => (RANK.indexOf(t.status) > RANK.indexOf(top) ? t.status : top), "idle"),
      computer: computerState({ id: coworker.id, computer }),
      expiresAt: computer?.expiresAt,
    })),
    threads,
    jobs: data.jobs,
    secrets: data.secrets.map(({ name, note, updatedAt }) => ({ name, note, updatedAt })),
  };
});
