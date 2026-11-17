"use client";

// A finding's evidence: the screen kept for it, large, and the screens on the way to
// it to step through. The picture shown first is the one this app chose (the last
// screen of the page the finding names), never one the agent picked.

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { host, type Finding, type RunView } from "@/shared/api";

export function Evidence({ run, finding, onLive }: { run: RunView; finding: Finding; onLive?: () => void }) {
  const screens = finding.screens.map((name) => run.screens.find((s) => s.name === name)).filter((s) => s !== undefined);
  const start = Math.max(0, finding.evidence ? screens.findIndex((s) => s.name === finding.evidence) : screens.length - 1);
  const [at, setAt] = useState(start);
  useEffect(() => setAt(start), [finding.n, start]);
  const shown = screens[Math.min(at, screens.length - 1)];
  const step = (by: number) => setAt((i) => Math.min(screens.length - 1, Math.max(0, i + by)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest?.("input, textarea")) return;
      if (event.key === "ArrowLeft") setAt((i) => Math.max(0, i - 1));
      if (event.key === "ArrowRight") setAt((i) => Math.min(screens.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screens.length]);

  const src = (name: string) => `/api/runs/${run.id}/screens/${name}`;
  const isEvidence = shown !== undefined && shown.name === finding.evidence;
  return (
    <section className="stage">
      <div className="monitor" data-status={finding.status}>
        <header className="monitor-bar">
          <p className="now">
            <span>
              {isEvidence ? "Evidence" : "On the way"} <small>· check {finding.n}</small>
            </span>
            {shown?.url ? <code>{host(shown.url)}</code> : null}
          </p>
          {screens.length > 1 ? (
            <div className="pager">
              <button className="btn sm icon ghost" aria-label="The screen before" disabled={at === 0} onClick={() => step(-1)}>
                <ChevronLeft />
              </button>
              <span className="mono">
                {at + 1} / {screens.length}
              </span>
              <button className="btn sm icon ghost" aria-label="The screen after" disabled={at >= screens.length - 1} onClick={() => step(1)}>
                <ChevronRight />
              </button>
            </div>
          ) : null}
          {onLive ? (
            <button className="btn sm primary" onClick={onLive}>
              <ArrowLeft /> Live screen
            </button>
          ) : null}
        </header>
        <div className="frame saved">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src(shown.name)} alt={`The Computer's screen: ${shown.caption}`} />
          ) : (
            <div className="veil">
              <h2>No screen was saved for this check</h2>
              <p>The finding stands on the agent&rsquo;s report alone. Run it again to capture one.</p>
            </div>
          )}
        </div>
      </div>

      <p className="proof" data-missing={!finding.evidence || undefined}>
        {finding.evidence
          ? isEvidence
            ? `The Computer's screen on ${host(finding.url)}, saved before this check was recorded.`
            : `A screen on the way to this check: ${shown?.caption ?? ""}`
          : "No saved screen shows the page this finding names: read it as the agent's report, not as evidence."}
      </p>

      {screens.length > 1 ? (
        <ol className="strip">
          {screens.map((screen, i) => (
            <li key={screen.name}>
              <button className="thumb" aria-pressed={i === at} onClick={() => setAt(i)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(screen.name)} alt="" loading="lazy" />
                <span>
                  <i>{String(i + 1).padStart(2, "0")}</i>
                  {screen.name === finding.evidence ? <b>Evidence</b> : <em>{screen.caption}</em>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
