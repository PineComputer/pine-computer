"use client";

import { MonitorOff } from "lucide-react";
import { useCallback, useState } from "react";
import type { CoworkerView, ThreadView } from "@/shared/api";
import { clock } from "../common/format";
import { useNow } from "../common/kit";
import { Desktop } from "./Desktop";

export interface ScreenProps {
  coworker: CoworkerView;
  thread: ThreadView;
  /** What it is doing now, in its words. */
  doing?: string;
  idleDeadline?: string;
  onRelease: () => void;
}

/** The coworker's live desktop beside the thread, and a clear banner while a person drives it. */
export function Screen({ coworker, thread, doing, idleDeadline, onRelease }: ScreenProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const onProblem = useCallback((text: string | null) => setProblem(text), []);
  const now = useNow();
  const driving = thread.status === "yours";
  const left = idleDeadline ? Math.ceil((Date.parse(idleDeadline) - now) / 1000) : null;
  const state = coworker.computer;
  // A job that is queued, or whose Computer is still starting, has no session to show yet.
  const pending = !thread.stream && thread.status === "working";

  return (
    <div className="screen">
      {driving ? (
        <div className="takeover" role="status">
          <i className="dot" data-status="yours" />
          <span>
            <b>You have the controls.</b> {coworker.name} is waiting{left !== null && left > 0 ? ` and takes over again in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} if you're idle` : ""}.
          </span>
          <button className="btn sm human" onClick={onRelease}>
            Hand back
          </button>
        </div>
      ) : null}
      <div className="frame" data-driver={driving ? "human" : thread.status === "working" && thread.stream ? "agent" : undefined}>
        {thread.stream ? (
          <Desktop thread={thread.id} stream={thread.stream} driving={driving} onProblem={onProblem} />
        ) : (
          <div className="frame-msg">
            <MonitorOff />
            <h2>
              {state === "starting"
                ? `Starting ${coworker.name}'s computer`
                : pending
                  ? `Waiting for ${coworker.name}'s computer`
                  : state === "running"
                    ? "This thread's session has ended"
                    : state === "none"
                      ? `${coworker.name} has no computer yet`
                      : `${coworker.name}'s computer is stopped`}
            </h2>
            <p>
              {state === "starting" || pending
                ? "The screen appears here when the job starts."
                : state === "none"
                  ? "Its first job creates one."
                  : "The next message here opens it again, with its sign-ins and skills. Answers and files in the thread are kept."}
            </p>
          </div>
        )}
      </div>
      {problem && thread.stream ? <p className="problem">{problem}</p> : null}
      <dl className="now">
        <dt>Now</dt>
        <dd>{driving ? "Waiting for you to hand back" : pending ? "Waiting to start" : thread.status === "working" ? (doing ?? "Working") : thread.status === "asking" ? "Waiting for your answer" : "Idle"}</dd>
        <dt>Computer</dt>
        <dd>
          {state === "running" ? `Running${coworker.expiresAt ? `, stops itself at ${clock(Date.parse(coworker.expiresAt))} if nothing uses it` : ""}` : state === "none" ? "Not created yet" : state[0].toUpperCase() + state.slice(1)}
        </dd>
      </dl>
    </div>
  );
}
