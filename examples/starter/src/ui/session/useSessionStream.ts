"use client";

import { useEffect, useRef, useState } from "react";
import type { WireControl, WireEvent } from "@/shared/events";

export interface ControlNow {
  /** agent | human | locked */
  controller: string;
  /** The session a person drives on this Computer, if any: one at a time. */
  humanSession?: string;
  idleDeadline?: string;
  idlePaused?: boolean;
}

/**
 * A session as it happens, from this app's server: the agent's events, who drives, and
 * each handoff saved when a person hands back. A dropped stream resumes from its last
 * event; a new conversation (a new Task) starts the events over. `stream` names the
 * session and its sandbox: a Start opens a new stream.
 */
export function useSessionStream(session: string, stream: string | null) {
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [control, setControl] = useState<ControlNow>({ controller: "agent" });
  const [handoffs, setHandoffs] = useState<{ id: string; cursor: number }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const controlCursor = useRef(0);

  useEffect(() => {
    setEvents([]);
    setControl({ controller: "agent" });
    setHandoffs([]);
    setProblem(null);
    controlCursor.current = 0;
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
      source = new EventSource(`/api/sessions/${encodeURIComponent(session)}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
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
        controlCursor.current = Math.max(controlCursor.current, change.id);
        if (change.type === "controller_changed" && change.controller) {
          setControl((now) => ({ ...now, controller: change.controller!, humanSession: change.humanSession }));
        } else if (change.type === "idle_changed") {
          setControl((now) => ({ ...now, idleDeadline: change.idleDeadline, idlePaused: change.idlePaused }));
        } else if ((change.type === "handoff_completed" || change.type === "handoff_failed") && change.handoffId) {
          setHandoffs((all) => (all.some((h) => h.id === change.handoffId) ? all : [...all, { id: change.handoffId!, cursor: change.id }]));
        }
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
  }, [session, stream]);

  return { events, control, handoffs, problem, controlCursor };
}
