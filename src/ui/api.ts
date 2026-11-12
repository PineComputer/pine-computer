// Talking to the engine: JSON calls, and data that refreshes itself when the engine says
// its scope changed (one shared event stream; after a reconnect everything refetches).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiFailure, ErrorCode, LiveMessage } from "../shared/types.ts";

/** A failed call: the engine's code for it (labels.ts words it), and its English. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
  } catch {
    throw new ApiError("The studio's engine isn't answering.", 0, "offline");
  }
  const body = (await response.json().catch(() => ({}))) as T & Partial<ApiFailure>;
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status}).`, response.status, body.code ?? "internal", body.detail);
  return body;
}

/** A click that calls the engine: whether it is under way, and what went wrong if it failed. */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>): { run: (...args: A) => Promise<void>; busy: boolean; error: unknown } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async (...args: A) => {
    setBusy(true);
    setError(undefined);
    try {
      await action(...args);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

type Listener = (scope: string) => void;
const listeners = new Set<Listener>();
let source: EventSource | undefined;

function connect() {
  if (source) return;
  const stream = new EventSource("/api/live");
  source = stream;
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data) as LiveMessage;
    // "hello" arrives on every (re)connect: refetch everything, nothing is replayed.
    const scope = message.type === "changed" ? message.scope : "*";
    for (const listener of listeners) listener(scope);
  };
  // The browser retries a dropped stream by itself, but gives up for good when the engine
  // answers with an error (as it does while restarting): then open a new one shortly.
  stream.onerror = () => {
    if (stream.readyState !== EventSource.CLOSED) return;
    source = undefined;
    window.setTimeout(() => listeners.size && connect(), 2_000);
  };
}

export function onLive(listener: Listener): () => void {
  connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * GETs a path, and again whenever one of its scopes changes. Refetches are coalesced, so
 * a burst of changes costs one request; an answer that arrives after a newer request was
 * made (or after the path changed) is dropped, so a slow one never overwrites a fresh one.
 */
export function useResource<T>(path: string | null, scopes: string[]): { data: T | undefined; error: unknown; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const scopeKey = scopes.join("|");
  const pending = useRef<number | undefined>(undefined);
  const latest = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const request = ++latest.current;
    api<T>(path)
      .then((value) => {
        if (request !== latest.current) return;
        setData(value);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (request === latest.current) setError(reason);
      });
  }, [path]);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    load();
    const wanted = scopeKey.split("|");
    const stop = onLive((scope) => {
      if (scope !== "*" && !wanted.includes(scope)) return;
      window.clearTimeout(pending.current);
      pending.current = window.setTimeout(load, 120);
    });
    return () => {
      stop();
      window.clearTimeout(pending.current);
      latest.current += 1; // whatever is still on its way belongs to the old path
    };
  }, [load, scopeKey]);

  return { data, error, reload: load };
}

export function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
