"use client";

import { useEffect, useMemo, useState } from "react";
import type { WireEvent } from "@/shared/events";
import { fold, type Item } from "@/shared/fold";
import { enc } from "../common/api";

/**
 * A brief as it happens, from this app's server: every reader's events on one stream,
 * folded into each run's steps. A stream that drops starts over, and the fold ignores
 * what it has already seen.
 */
export function useBriefStream(brief: string, on: boolean): Map<string, Item[]> {
  const [events, setEvents] = useState<WireEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (!on) return;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // A connection replays each session's history at once: draw it in batches, one per frame.
    let pending: WireEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      setEvents((previous) => previous.concat(batch));
    };
    const open = () => {
      setEvents([]);
      source = new EventSource(`/api/briefs/${enc(brief)}/events`);
      source.onmessage = (message) => {
        pending.push(JSON.parse(message.data) as WireEvent);
        frame ||= requestAnimationFrame(flush);
      };
      // Open it again ourselves, so every connection starts from the beginning.
      source.onerror = () => {
        source?.close();
        if (!stopped) retry = setTimeout(open, 3_000);
      };
    };
    open();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retry);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [brief, on]);

  return useMemo(() => {
    const byRun = new Map<string, WireEvent[]>();
    for (const event of events) {
      const list = byRun.get(event.run);
      if (list) list.push(event);
      else byRun.set(event.run, [event]);
    }
    return new Map([...byRun].map(([run, list]) => [run, fold(list)]));
  }, [events]);
}
