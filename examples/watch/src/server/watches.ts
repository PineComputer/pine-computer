// A watch: what to look at, where, and how often. The worker checks it at its times;
// creating one makes its first check at once, so there is something to compare with.

import "server-only";
import { randomBytes } from "node:crypto";
import type { Cadence } from "@/shared/api";
import { next, validCadence } from "@/shared/cadence";
import { begin, cancel, forgetScreens, liveCheck } from "./checks";
import { HttpError } from "./http";
import { readUser, updateUser, type WatchRecord } from "./store";

export async function createWatch(user: string, input: { what?: string; url?: string; cadence?: Cadence }): Promise<WatchRecord> {
  const what = input.what?.trim();
  if (!what) throw new HttpError(400, "Say what to watch.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.url?.trim() ?? "") ? input.url!.trim() : `https://${input.url?.trim()}`);
    if (!url.hostname.includes(".")) throw new Error();
  } catch {
    throw new HttpError(400, "Give the address of the page to watch.");
  }
  const cadence = input.cadence;
  if (!cadence || !validCadence(cadence)) throw new HttpError(400, "Choose how often to look: every 15 minutes or more, or a time of day.");
  const record: WatchRecord = {
    id: `wch_${randomBytes(5).toString("hex")}`,
    what,
    url: url.toString(),
    cadence,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextAt: next(cadence, new Date()).toISOString(),
  };
  await updateUser(user, (data) => void data.watches.push(record));
  // The first look, now. If the Computer is busy, the schedule makes it instead.
  await begin(user, record.id, "first").catch(() => undefined);
  return record;
}

export async function setEnabled(user: string, id: string, enabled: boolean): Promise<void> {
  await updateUser(user, (data) => {
    const watch = data.watches.find((w) => w.id === id);
    if (!watch) throw new HttpError(404, "There's no such watch.");
    watch.enabled = enabled;
    delete watch.retryAt;
    delete watch.waiting;
    // Resumed, it is checked at its next time from now, not at the ones it missed.
    if (enabled) watch.nextAt = next(watch.cadence, new Date()).toISOString();
  });
}

/** Deletes a watch with its history and pictures. A check of its that is running is canceled. */
export async function deleteWatch(user: string, id: string): Promise<void> {
  const data = await readUser(user);
  const live = liveCheck(data);
  if (live?.watchId === id) await cancel(user, live.id);
  const gone = data.checks.filter((c) => c.watchId === id).map((c) => c.id);
  await updateUser(user, (next) => {
    next.watches = next.watches.filter((w) => w.id !== id);
    next.checks = next.checks.filter((c) => c.watchId !== id);
  });
  await forgetScreens(user, gone);
}
