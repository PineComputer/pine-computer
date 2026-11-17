"use client";

import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AppState, CheckView, WatchView } from "@/shared/api";
import { describeCadence } from "@/shared/cadence";
import { call, errorText } from "./api";
import { Change, Reading } from "./Change";
import { stateOf } from "./Desk";
import { hostOf } from "./format";
import { LiveCheck } from "./LiveCheck";

/** One watch, large: what it is, what it is doing now, and the selected check as the proof. */
export function Stage({ app, watch, check, onDeleted }: { app: AppState; watch: WatchView; check?: CheckView; onDeleted: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const state = stateOf(watch, app);
  const act = (work: () => Promise<unknown>) => {
    setProblem(null);
    work().catch((error) => setProblem(errorText(error)));
  };
  const live = check && check.id === app.live;
  const before = check?.comparedWith ? watch.checks.find((c) => c.id === check.comparedWith) : undefined;

  return (
    <main className="stage">
      <header className="stage-head">
        <div>
          <h1>{watch.what}</h1>
          <p className="meta">
            <span className="state">
              <i className="dot" data-tone={state.tone} /> {state.text}
            </span>
            <a href={watch.url} target="_blank" rel="noreferrer">
              {hostOf(watch.url)}
            </a>
            <span>{describeCadence(watch.cadence)}</span>
            {problem && <span className="problem">{problem}</span>}
            {watch.waiting && <span className="problem">{watch.waiting}</span>}
          </p>
        </div>
        <div className="actions">
          <button className="btn" disabled={Boolean(app.live)} onClick={() => act(() => call(`/api/watches/${watch.id}/check`, { method: "POST" }))}>
            <RefreshCw /> Check now
          </button>
          <button className="btn" onClick={() => act(() => call(`/api/watches/${watch.id}`, { method: "PATCH", body: { enabled: !watch.enabled } }))}>
            {watch.enabled ? <Pause /> : <Play />} {watch.enabled ? "Pause" : "Resume"}
          </button>
          {confirming ? (
            <button className="btn danger" onBlur={() => setConfirming(false)} onClick={() => act(() => call(`/api/watches/${watch.id}`, { method: "DELETE" }).then(onDeleted))} autoFocus>
              <Trash2 /> Delete it and its history
            </button>
          ) : (
            <button className="btn ghost danger" title="Delete this watch" onClick={() => setConfirming(true)}>
              <Trash2 />
            </button>
          )}
        </div>
      </header>
      {!check ? (
        <section className="proof">
          <p className="sentence quiet">No checks yet.</p>
        </section>
      ) : live ? (
        <LiveCheck app={app} watch={watch} check={check} />
      ) : check.outcome === "changed" && before ? (
        <Change check={check} before={before} />
      ) : (
        <Reading check={check} before={before} />
      )}
    </main>
  );
}
