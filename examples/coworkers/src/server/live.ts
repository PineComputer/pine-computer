// What the server tells the open pages as it happens: a record changed, a job finished
// or needs an answer. /api/live streams it to the browser.

import { EventEmitter } from "node:events";
import type { LiveEvent } from "@/shared/api";

// One emitter per process, however many times Next.js bundles this module.
const shared = globalThis as typeof globalThis & { __live?: EventEmitter };
shared.__live ??= new EventEmitter().setMaxListeners(0);
const live = shared.__live;

export function publish(event: LiveEvent): void {
  live.emit("event", event);
}

export function subscribe(listener: (event: LiveEvent) => void): () => void {
  live.on("event", listener);
  return () => live.off("event", listener);
}
