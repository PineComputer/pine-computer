// The record: an append-only log of everything that happens, each event with a
// receipt. It is the source of truth for the observatory, and it is how anyone can
// tell what a resident did from what someone said it did.

import { EventEmitter } from "node:events";
import { all, now, run } from "./db";

export interface HabitatEvent {
  id: number;
  at: string;
  actor: string;
  kind: string;
  subject: string | null;
  summary: string;
  data: Record<string, unknown>;
  receipt: Record<string, unknown>;
}

const shared = globalThis as typeof globalThis & { __habitatLive?: EventEmitter };
shared.__habitatLive ??= new EventEmitter().setMaxListeners(0);
const live = shared.__habitatLive;

/** Appends an event and tells the open pages. */
export function record(
  actor: string,
  kind: string,
  summary: string,
  options: { subject?: string; data?: Record<string, unknown>; receipt?: Record<string, unknown> } = {},
): void {
  run(
    "insert into events (at, actor, kind, subject, summary, data, receipt) values (?, ?, ?, ?, ?, ?, ?)",
    now(),
    actor,
    kind,
    options.subject ?? null,
    summary,
    JSON.stringify(options.data ?? {}),
    JSON.stringify(options.receipt ?? {}),
  );
  live.emit("event", kind);
}

export function events(options: { after?: number; limit?: number; actor?: string; kinds?: string[] } = {}): HabitatEvent[] {
  const where: string[] = ["id > ?"];
  const params: (string | number)[] = [options.after ?? 0];
  if (options.actor) {
    where.push("actor = ?");
    params.push(options.actor);
  }
  if (options.kinds?.length) {
    where.push(`kind in (${options.kinds.map(() => "?").join(",")})`);
    params.push(...options.kinds);
  }
  const rows = all<Omit<HabitatEvent, "data" | "receipt"> & { data: string; receipt: string }>(
    `select * from events where ${where.join(" and ")} order by id desc limit ?`,
    ...params,
    options.limit ?? 100,
  );
  return rows.map((row) => ({ ...row, data: JSON.parse(row.data), receipt: JSON.parse(row.receipt) }));
}

export function onEvent(listener: (kind: string) => void): () => void {
  live.on("event", listener);
  return () => live.off("event", listener);
}
