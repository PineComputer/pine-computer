"use client";

import { Hand } from "lucide-react";
import { useState } from "react";
import type { AppState, CheckView, WatchView } from "@/shared/api";
import { call, errorText } from "./api";
import { Desktop } from "./Desktop";
import { TRIGGER } from "./Feed";
import { clock } from "./format";

/**
 * A check in progress: the Computer's own screen, large, and the step it is on. If the
 * page needs the person (a sign-in), this is where they take the controls and hand back.
 */
export function LiveCheck({ app, watch, check }: { app: AppState; watch: WatchView; check: CheckView }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    work()
      .catch((error) => setProblem(errorText(error)))
      .finally(() => setBusy(false));
  };
  const asking = check.state === "asking";
  // Until the Computer's browser is open, the last screen this watch kept.
  const up = asking || Boolean(check.onScreen);
  // It connects as soon as the Computer runs, so the picture is ready when there is one.
  const reachable = app.computer === "running" && check.state !== "starting";
  const last = watch.checks.find((c) => c.hasScreen);

  return (
    <section className="proof">
      <div className="kicker">
        <span className="tag" data-tone={asking ? "human" : "live"}>
          {asking ? "Your turn" : "Checking now"}
        </span>
        <span>
          {TRIGGER[check.trigger]}
          {check.dueAt ? ` for ${clock(check.dueAt)}` : ""} · started {clock(check.startedAt, true)}
        </span>
      </div>
      {asking && (
        <div className="turn">
          <div>
            <b>{check.question}</b>
            <p>{app.driving ? "You have the controls. Sign in on the screen below, then hand back." : "Take the controls to sign in on the screen below. A sign-in may need repeating after the Computer has been stopped."}</p>
            {problem && <p className="problem">{problem}</p>}
          </div>
          <div className="buttons">
            <button className="btn ghost" disabled={busy} onClick={() => act(() => call(`/api/checks/${check.id}/cancel`, { method: "POST" }))}>
              Skip this check
            </button>
            {app.driving ? (
              <button className="btn human" disabled={busy} onClick={() => act(() => call(`/api/checks/${check.id}/answer`, { body: { text: "I have signed in. Open the page again and carry on." } }))}>
                Hand back and carry on
              </button>
            ) : (
              <button className="btn human" disabled={busy} onClick={() => act(() => call("/api/control", { body: { action: "take" } }))}>
                <Hand /> Take the controls
              </button>
            )}
          </div>
        </div>
      )}
      <div className="screen" data-driver={app.driving ? "human" : "agent"}>
        {last && <div className="last" style={{ backgroundImage: `url(/api/checks/${last.id}/screen)` }} />}
        <span className="note">{last ? `The last screen, from ${clock(last.endedAt ?? last.startedAt)}` : "The Computer's screen appears here"}</span>
        {reachable && <Desktop driving={app.driving} shown={up} />}
      </div>
      {!asking && (
        <p className="step">
          <i className="dot" data-tone="live" /> {check.step ?? "Working"}
        </p>
      )}
    </section>
  );
}
