// What the server tells a user's open pages as it happens: records changed, a site
// wants a passkey, a scheduled task started. /api/live streams it to the browser.

import { EventEmitter } from "node:events";
import type { LiveEvent } from "@/shared/api";

// One emitter per process, however many times Next.js bundles this module.
const shared = globalThis as typeof globalThis & { __live?: EventEmitter };
shared.__live ??= new EventEmitter().setMaxListeners(0);
const live = shared.__live;

export function publish(user: string, event: LiveEvent): void {
  live.emit(user, event);
}

export function subscribe(user: string, listener: (event: LiveEvent) => void): () => void {
  live.on(user, listener);
  return () => live.off(user, listener);
}
