"use client";

// Follows a skill-authoring run as it happens: its notes and steps, then the result.

import { useCallback, useEffect, useState } from "react";
import type { Outcome, WireEvent } from "@/shared/events";
import { call, enc, errorText } from "../common/api";

export interface AuthorLine {
  id: string;
  text: string;
  state?: string;
}

export interface AuthorRunState {
  session: string;
  authorId: string;
  startedAt: number;
  endedAt?: number;
  lines: AuthorLine[];
  outcome?: Outcome;
  problem?: string;
  done: boolean;
}

export function useAuthorRun(onOutcome: (outcome: Outcome) => void) {
  const [run, setRun] = useState<AuthorRunState | null>(null);

  const follow = useCallback((session: string, authorId: string) => {
    setRun({ session, authorId, startedAt: Date.now(), lines: [], done: false });
  }, []);

  const cancel = useCallback(async () => {
    if (!run || run.done) return;
    try {
      await call(`/api/sessions/${enc(run.session)}/author/${enc(run.authorId)}`, { method: "DELETE" });
    } catch (error) {
      setRun((r) => r && { ...r, problem: errorText(error) });
    }
  }, [run]);

  const clear = useCallback(() => setRun(null), []);

  const session = run?.session;
  const authorId = run?.authorId;
  const finished = run?.done ?? true;

  useEffect(() => {
    if (!session || !authorId || finished) return;
    const source = new EventSource(`/api/sessions/${enc(session)}/author/${enc(authorId)}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WireEvent;
      setRun((r) => {
        if (!r || r.authorId !== authorId) return r;
        if (event.outcome) return { ...r, outcome: event.outcome };
        if (event.progress) return { ...r, lines: [...r.lines, { id: `e${event.id}`, text: event.progress.text }] };
        if (event.step) {
          const step = event.step;
          const known = r.lines.some((l) => l.id === step.id);
          const line = { id: step.id, text: step.title, state: step.state };
          return { ...r, lines: known ? r.lines.map((l) => (l.id === step.id ? line : l)) : [...r.lines, line] };
        }
        return r;
      });
    };
    const end = () => {
      source.close();
      setRun((r) => (r && r.authorId === authorId ? { ...r, done: true, endedAt: Date.now() } : r));
    };
    source.addEventListener("end", end);
    source.addEventListener("problem", (message) => {
      const { error } = JSON.parse((message as MessageEvent).data) as { error: string };
      source.close();
      setRun((r) => (r && r.authorId === authorId ? { ...r, problem: error, done: true, endedAt: Date.now() } : r));
    });
    return () => source.close();
  }, [session, authorId, finished]);

  // The result arrives once; tell the view when the run is over with it.
  const outcome = run?.done ? run.outcome : undefined;
  useEffect(() => {
    if (outcome) onOutcome(outcome);
  }, [outcome, onOutcome]);

  return { run, follow, cancel, clear };
}
