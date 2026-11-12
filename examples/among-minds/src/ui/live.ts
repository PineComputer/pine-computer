"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// One connection per page to /api/live, shared by every hook on it.
let source: EventSource | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/live");
    source.onmessage = () => listeners.forEach((l) => l());
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close();
      source = null;
    }
  };
}

/** Reads `path`, and reads it again whenever something happens in the habitat. */
export function useLive<T>(path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const response = await fetch(path, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `The request failed (${response.status}).`);
      setData(body as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "It didn't load.");
    }
  }, [path]);

  useEffect(() => {
    void load();
    const off = subscribe(() => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 400);
    });
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      off();
      clearInterval(poll);
      clearTimeout(timer.current);
    };
  }, [load]);

  return { data, error, reload: () => void load() };
}

export async function send<T = Record<string, unknown>>(path: string, body: unknown, method = "POST"): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(path, {
    method,
    headers: form ? undefined : { "Content-Type": "application/json" },
    body: form ? body : JSON.stringify(body),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error ?? `The request failed (${response.status}).`);
  return answer as T;
}
