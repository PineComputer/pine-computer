"use client";

import { useEffect, useState } from "react";
import type { WireControl, WireEvent } from "@/shared/events";
import { enc } from "../common/api";

/**
 * A thread as it happens, from this app's server: the coworker's events, and when a
 * person's turn at the controls runs out. A dropped stream resumes from its last event.
 * `stream` names the thread's session and its sandbox: a Start opens a new stream.
 */
export function useThreadStream(thread: string, stream: string | null) {
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [idleDeadline, setIdleDeadline] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setEvents([]);
    setIdleDeadline(undefined);
    setProblem(null);
    if (!stream) return;

    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cursor = "";
    let task = "";
    let stopped = false;
    // The first connection replays the session's history at once: draw it in batches,
    // one per frame, instead of once per event.
    let pending: WireEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      setEvents((previous) => previous.concat(batch));
    };

    const open = () => {
      source = new EventSource(`/api/threads/${enc(thread)}/events${cursor ? `?cursor=${enc(cursor)}` : ""}`);
      source.onmessage = (message) => {
        cursor = message.lastEventId || cursor;
        pending.push(JSON.parse(message.data) as WireEvent);
        frame ||= requestAnimationFrame(flush);
        setProblem(null);
      };
      source.addEventListener("task", (message) => {
        const { taskId } = JSON.parse((message as MessageEvent).data) as { taskId: string };
        cursor = (message as MessageEvent).lastEventId || cursor;
        // A new conversation: what came before belongs to the old one.
        if (task && taskId !== task) {
          pending = [];
          setEvents([]);
        }
        task = taskId;
      });
      source.addEventListener("control", (message) => {
        const change = JSON.parse((message as MessageEvent).data) as WireControl;
        cursor = (message as MessageEvent).lastEventId || cursor;
        if (change.type === "idle_changed") setIdleDeadline(change.idleDeadline);
      });
      source.addEventListener("problem", (message) => {
        setProblem((JSON.parse((message as MessageEvent).data) as { error: string }).error);
      });
      // EventSource retries a stream that ended, but gives up on an HTTP error (while
      // the Computer restarts, say): open it again from where it was.
      source.onerror = () => {
        if (stopped || source?.readyState !== EventSource.CLOSED) return;
        retry = setTimeout(open, 3_000);
      };
    };
    open();

    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retry);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [thread, stream]);

  return { events, idleDeadline, problem };
}
