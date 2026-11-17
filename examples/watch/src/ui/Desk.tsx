"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { brand } from "@/brand";
import type { AppState, CheckView, WatchView } from "@/shared/api";
import { describeCadence } from "@/shared/cadence";
import { call } from "./api";
import { Feed } from "./Feed";
import { capital, hostOf, when } from "./format";
import { NewWatch } from "./NewWatch";
import { Stage } from "./Stage";
import { ThemeToggle } from "./Theme";

/** What a watch is doing now, in a few words: "Stopped · next check 14:30". */
export function stateOf(watch: WatchView, app: AppState): { tone: string; text: string } {
  const live = watch.checks.find((c) => c.id === app.live);
  if (live?.state === "asking") return { tone: "human", text: "Waiting for you" };
  if (live) return { tone: "live", text: "Checking now" };
  if (!watch.enabled) return { tone: "quiet", text: "Paused" };
  if (watch.waiting) return { tone: "bad", text: "Waiting for a Computer · trying again shortly" };
  const next = `next check ${when(watch.nextAt)}`;
  if (app.computer === "stopping") return { tone: "idle", text: `Stopping · ${next}` };
  return { tone: "idle", text: app.computer === "stopped" || app.computer === "none" ? `Stopped · ${next}` : capital(next) };
}

const COMPUTER: Record<AppState["computer"], string> = {
  none: "No Computer yet: the first check creates it",
  stopped: "Computer stopped until the next check",
  starting: "Computer starting",
  running: "Computer running",
  stopping: "Computer stopping",
};

/** The whole product: the watches and the selected watch's checks on the left, the proof on the right. */
export function Desk() {
  const [app, setApp] = useState<AppState | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  // The check the person opened. Until they open one, the stage follows the newest.
  const [checkId, setCheckId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => call<AppState>("/api/app").then(setApp, () => undefined), []);
  useEffect(() => {
    void refresh();
    const source = new EventSource("/api/live");
    source.onmessage = () => void refresh();
    // A page that was asleep missed what happened: read it again.
    source.onopen = () => void refresh();
    return () => source.close();
  }, [refresh]);

  // The times on the page ("next check 14:30") are read against the clock once a minute.
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!app) return <div className="desk" />;
  const watch = adding ? undefined : (app.watches.find((w) => w.id === watchId) ?? app.watches[0]);
  const check: CheckView | undefined = watch && (watch.checks.find((c) => c.id === checkId) ?? watch.checks.find((c) => c.id === app.live) ?? watch.checks[0]);
  const open = (id: string) => {
    setWatchId(id);
    setCheckId(null);
    setAdding(false);
  };

  return (
    <div className="desk">
      <aside className="side">
        <div className="side-head">
          <span className="wordmark">
            <i /> {brand.name}
          </span>
          <ThemeToggle />
        </div>
        <div className="side-title">
          <span className="label">Watches</span>
          <button className="btn ghost sm" onClick={() => setAdding(true)} disabled={adding || !app.watches.length}>
            <Plus /> New watch
          </button>
        </div>
        <nav className="watches">
          {app.watches.map((w) => {
            const state = stateOf(w, app);
            return (
              <button key={w.id} className="watch" aria-current={w.id === watch?.id} onClick={() => open(w.id)}>
                <b>{w.what}</b>
                <span>
                  {hostOf(w.url)} · {describeCadence(w.cadence)}
                </span>
                <span className="state">
                  <i className="dot" data-tone={state.tone} /> {state.text}
                </span>
              </button>
            );
          })}
          {!app.watches.length && <p className="feed-empty">Nothing is being watched yet.</p>}
        </nav>
        {watch ? <Feed watch={watch} current={check?.id} onOpen={setCheckId} /> : <div className="feed" />}
        <div className="side-foot">
          <span>
            <i className="dot" data-tone={app.computer === "running" ? "live" : "quiet"} /> {COMPUTER[app.computer]}
          </span>
        </div>
      </aside>
      {watch ? <Stage app={app} watch={watch} check={check} onDeleted={() => open("")} /> : <NewWatch first={!app.watches.length} onCreated={open} onCancel={() => setAdding(false)} />}
    </div>
  );
}
