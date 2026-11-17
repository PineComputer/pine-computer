"use client";

import { useState } from "react";
import { brand } from "@/brand";
import type { Cadence } from "@/shared/api";
import { describeCadence } from "@/shared/cadence";
import { call, errorText } from "./api";
import { hostOf } from "./format";

const EVERY = [15, 30, 60, 360];

/** First watches to try: pages that change within the hour. */
const IDEAS: { what: string; url: string; cadence: Cadence }[] = [
  { what: "The top story on Hacker News", url: "https://news.ycombinator.com", cadence: { kind: "interval", minutes: 15 } },
  { what: "The first repository on GitHub's trending page, and its language", url: "https://github.com/trending", cadence: { kind: "interval", minutes: 60 } },
  { what: "The headline of the lead story on the BBC News front page", url: "https://www.bbc.com/news", cadence: { kind: "interval", minutes: 30 } },
];

/** A new watch, in plain words: what to look at, where, and how often. */
export function NewWatch({ first, onCreated, onCancel }: { first: boolean; onCreated: (id: string) => void; onCancel: () => void }) {
  const [what, setWhat] = useState("");
  const [url, setUrl] = useState("");
  const [every, setEvery] = useState("15");
  const [at, setAt] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cadence: Cadence = every === "daily" || every === "weekdays" ? { kind: "daily", at, weekdays: every === "weekdays" } : { kind: "interval", minutes: Number(every) };

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      onCreated((await call<{ id: string }>("/api/watches", { body: { what, url, cadence } })).id);
    } catch (error) {
      setProblem(errorText(error));
      setBusy(false);
    }
  }

  return (
    <main className="stage">
      <div className="new">
        <h1>What should {brand.name} watch?</h1>
        <p className="lede">Say it in plain words. A Pine Computer opens the page in a real browser on your schedule, and you see what changed, with the screen before and after.</p>
        <form onSubmit={create}>
          <label className="field">
            <span className="label">What to watch</span>
            <textarea className="textarea" rows={2} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="The pricing page: tell me when a price or a plan changes" autoFocus />
          </label>
          <div className="row">
            <label className="field">
              <span className="label">Where</span>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com/pricing" spellCheck={false} />
            </label>
            <label className="field">
              <span className="label">How often</span>
              <span className="how">
                <select className="select" value={every} onChange={(e) => setEvery(e.target.value)}>
                  {EVERY.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {describeCadence({ kind: "interval", minutes })}
                    </option>
                  ))}
                  <option value="daily">Every day at</option>
                  <option value="weekdays">Weekdays at</option>
                </select>
                {(every === "daily" || every === "weekdays") && <input className="input mono" type="time" value={at} onChange={(e) => setAt(e.target.value)} />}
              </span>
            </label>
          </div>
          <div className="go">
            <button className="btn primary lg" disabled={busy || !what.trim() || !url.trim()}>
              Start watching
            </button>
            {!first && (
              <button type="button" className="btn ghost lg" onClick={onCancel}>
                Cancel
              </button>
            )}
            {problem && <span className="problem">{problem}</span>}
          </div>
          <p className="fine">
            The first check is made at once. Between checks the Computer is stopped. If the page needs a sign-in, the check asks you to take the controls and sign in; a sign-in may need repeating after the Computer has been stopped.
          </p>
        </form>
        <div className="ideas">
          <span className="label">Or start with one of these</span>
          {IDEAS.map((idea) => (
            <button
              key={idea.url}
              type="button"
              className="idea"
              onClick={() => {
                setWhat(idea.what);
                setUrl(hostOf(idea.url) + new URL(idea.url).pathname.replace(/\/$/, ""));
                setEvery(String(idea.cadence.kind === "interval" ? idea.cadence.minutes : "daily"));
              }}
            >
              <b>{idea.what}</b>
              <span>
                {hostOf(idea.url)} · {describeCadence(idea.cadence).toLowerCase()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
