// What changed, for open pages. Pages refetch what they show when their scope changes,
// and refetch everything after a reconnect, so nothing here needs replaying.
import type { LiveMessage } from "../shared/types.ts";

type Listener = (message: LiveMessage) => void;

const shared = globalThis as typeof globalThis & { __studioLive?: Set<Listener> };
const listeners = (shared.__studioLive ??= new Set());

/** Scopes: "dramas", "drama:<id>", "inbox", "session:<id>". */
export function publish(...scopes: string[]): void {
  for (const scope of new Set(scopes)) for (const listener of listeners) listener({ type: "changed", scope });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
