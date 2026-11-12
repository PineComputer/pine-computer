"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEvent, Nudge, Snapshot, Step } from "@/shared/api";

export interface Live extends Snapshot {
  progress: string;
  controller: string;
  connected: boolean;
}

/** The demo as the server sees it, kept current over /api/live. Nudges go to `onNudge` as they arrive. */
export function useLive(onNudge: (nudge: Nudge) => void): Live | null {
  const [live, setLive] = useState<Live | null>(null);
  const nudge = useRef(onNudge);
  nudge.current = onNudge;

  useEffect(() => {
    const source = new EventSource("/api/live");
    const on = <T,>(type: string, fn: (data: T) => void) => source.addEventListener(type, (e) => fn(JSON.parse((e as MessageEvent).data)));
    on<Snapshot>("snapshot", (s) => setLive((prev) => ({ progress: "", controller: prev?.controller ?? "agent", ...s, connected: true })));
    on<Extract<LiveEvent, { type: "case" }>>("case", (e) => setLive((p) => p && { ...p, claim: e.claim, steps: e.claim ? p.steps : [], progress: e.claim ? p.progress : "" }));
    on<Extract<LiveEvent, { type: "computer" }>>("computer", (e) => setLive((p) => p && { ...p, computer: e.computer }));
    on<Extract<LiveEvent, { type: "step" }>>("step", (e) =>
      setLive((p) => {
        if (!p) return p;
        const steps: Step[] = p.steps.some((s) => s.id === e.step.id) ? p.steps.map((s) => (s.id === e.step.id ? e.step : s)) : [...p.steps, e.step];
        return { ...p, steps: steps.slice(-60) };
      }),
    );
    on<Extract<LiveEvent, { type: "progress" }>>("progress", (e) => setLive((p) => p && { ...p, progress: e.text }));
    on<Extract<LiveEvent, { type: "control" }>>("control", (e) => setLive((p) => p && { ...p, controller: e.controller }));
    on<Extract<LiveEvent, { type: "nudge" }>>("nudge", (e) => nudge.current(e.nudge));
    source.onerror = () => setLive((p) => p && { ...p, connected: false });
    return () => source.close();
  }, []);

  return live;
}

export async function post<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `${response.status}`);
  return data as T;
}
