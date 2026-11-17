"use client";

// One run. Across the top, the result line. On the left, the report as it forms: the
// checks as a ruled, numbered list, and the selected one opened with what was expected, what was observed and how to
// reproduce it. On the right, large, the picture that backs it: the Computer's live
// screen while the run is going, and the screen kept as evidence once a finding is
// opened.

import { Download, Hand, Printer, RotateCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { host, open, question, tally, working, type Finding, type RunView as Run } from "@/shared/api";
import { call } from "../common/api";
import { newKey } from "../app/Home";
import { useWorkspace } from "../app/Workspace";
import { Desktop } from "./Desktop";
import { Evidence } from "./Evidence";

const ENDED: Record<string, string> = { canceled: "Stopped", failed: "Did not finish", stopped: "Stopped with its Computer" };

export function RunView({ id }: { id: string }) {
  const { ws, act } = useWorkspace();
  const router = useRouter();
  const run = ws.runs.find((r) => r.id === id);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const going = run ? open(run) : false;

  // The report opens on what matters: the first failure, or the first check.
  const first = run?.findings.find((f) => f.status === "failed") ?? run?.findings[0];
  useEffect(() => {
    if (!going && selected === null && first) setSelected(first.n);
  }, [going, selected, first]);

  if (!run) {
    return (
      <main className="home">
        <div className="home-in">
          <header className="home-head">
            <h1>That run isn&rsquo;t kept here.</h1>
            <p>
              <Link href="/">See every run</Link>
            </p>
          </header>
        </div>
      </main>
    );
  }

  const count = tally(run.findings);
  const finding = run.findings.find((f) => f.n === selected);
  const ask = run.state === "needs_input" ? question(run.question ?? "") : null;
  const send = async (action: string, text?: string) => {
    setBusy(action);
    await act(() => call(`/api/runs/${run.id}`, { body: { action, text } }));
    setBusy(null);
  };

  return (
    <main className="run">
      <header className="report-head">
        <h1 data-failed={count.failed > 0 || undefined}>
          {count.checks ? (
            <>
              {count.checks} {count.checks === 1 ? "check" : "checks"}
              {going ? " so far" : ""}
              {count.failed || !going ? ", " : ""}
              <em>{count.failed ? `${count.failed} failed` : going ? "" : "all passed"}</em>
            </>
          ) : going ? (
            "Walking the flow"
          ) : (
            "No checks recorded"
          )}
        </h1>
        <p className="label">
          Target
          <span className="mono">{host(run.target)}</span>
        </p>
        {!going && run.state !== "completed" && run.summary ? <p className="ended">{run.summary}</p> : null}
      </header>

      <aside className="report">
        <div className="report-scroll">
          {ask && run.driving && !ask.approval ? (
            <section className="ask" role="group" aria-label="The run waits for the controls">
              <p className="label">You have the controls</p>
              <p className="words">The run waits. Hand back and it carries on from where you left the page.</p>
              <div className="acts">
                <button className="btn human" aria-busy={busy === "release"} disabled={busy !== null} onClick={() => void send("release")}>
                  Hand back
                </button>
              </div>
            </section>
          ) : ask ? (
            <Ask approval={ask.approval} text={ask.text} busy={busy} onSend={send} />
          ) : null}

          {run.findings.length ? (
            <ol className="findings">
              {run.findings.map((f) => (
                <li key={f.n}>
                  <FindingRow finding={f} open={f.n === selected} onToggle={() => setSelected(f.n === selected && going ? null : f.n)} />
                </li>
              ))}
            </ol>
          ) : null}
          {going && !ask ? <p className="pending">{run.findings.length ? "The next check lands here when it is recorded." : "Each check lands here the moment it is recorded, with the screen that shows it."}</p> : null}

          <details className="asked" open={!run.findings.length}>
            <summary className="label">What was asked</summary>
            <p>{run.checks}</p>
          </details>
        </div>

        <footer className="report-foot">
          {going ? (
            <button className="btn sm" aria-busy={busy === "cancel"} disabled={busy !== null || run.state === "canceling"} onClick={() => void send("cancel")}>
              <Square /> Stop the run
            </button>
          ) : (
            <>
              <a className="btn sm" href={`/api/runs/${run.id}/report`} download>
                <Download /> Markdown
              </a>
              <a className="btn sm" href={`/r/${run.id}/print`} target="_blank" rel="noreferrer">
                <Printer /> Print or PDF
              </a>
              <span className="push" />
              <button
                className="btn sm ghost"
                title="Run these checks again"
                disabled={ws.runs.some(open)}
                onClick={async () => {
                  const key = newKey();
                  if (await act(() => call("/api/runs", { body: { key, target: run.target, checks: run.checks } }))) router.push(`/r/${key}`);
                }}
              >
                <RotateCw /> Again
              </button>
              <button
                className="btn sm ghost icon"
                title="Delete this run"
                aria-label="Delete this run"
                onClick={async () => {
                  await act(() => call(`/api/runs/${run.id}`, { method: "DELETE" }));
                  router.push("/");
                }}
              >
                <Trash2 />
              </button>
            </>
          )}
        </footer>
      </aside>

      <Stage run={run} finding={finding} computer={ws.computer} onLive={() => setSelected(null)} onControl={(action) => void send(action)} controlBusy={busy === "take" || busy === "release"} />
    </main>
  );
}

function FindingRow({ finding, open: opened, onToggle }: { finding: Finding; open: boolean; onToggle: () => void }) {
  return (
    <article className="finding" data-status={finding.status} data-open={opened || undefined}>
      <button className="finding-row" aria-expanded={opened} onClick={onToggle}>
        <span className="num">{String(finding.n).padStart(2, "0")}</span>
        <span className="title">{finding.title}</span>
        <span className="status">{finding.status === "failed" ? "Failed" : "Passed"}</span>
      </button>
      {opened ? (
        <div className="finding-body">
          <dl>
            <dt>Expected</dt>
            <dd>{finding.expected}</dd>
            <dt>Observed</dt>
            <dd className="observed">{finding.observed}</dd>
            {finding.where ? (
              <>
                <dt>Where</dt>
                <dd>{finding.where}</dd>
              </>
            ) : null}
          </dl>
          {finding.steps.length ? (
            <>
              <h3 className="label">Steps to reproduce</h3>
              <ol className="repro">
                {finding.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** The run stopped and waits for a person: an approval, or a question in words. */
function Ask({ approval, text, busy, onSend }: { approval: boolean; text: string; busy: string | null; onSend: (action: string, text?: string) => Promise<void> }) {
  const [reply, setReply] = useState("");
  return (
    <section className="ask" role="group" aria-label={approval ? "Approval needed" : "A question for you"}>
      <p className="label">{approval ? "Approval needed" : "A question for you"}</p>
      <p className="words">{text}</p>
      {approval ? (
        <div className="acts">
          <button className="btn human" aria-busy={busy === "approve"} disabled={busy !== null} onClick={() => void onSend("approve")}>
            Approve
          </button>
          <button className="btn" aria-busy={busy === "decline"} disabled={busy !== null} onClick={() => void onSend("decline")}>
            Decline
          </button>
        </div>
      ) : (
        <form
          className="acts"
          onSubmit={(event) => {
            event.preventDefault();
            if (reply.trim()) void onSend("answer", reply);
          }}
        >
          <input className="input" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Your answer" />
          <button className="btn human" aria-busy={busy === "answer"} disabled={busy !== null || !reply.trim()}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}

interface StageProps {
  run: Run;
  finding?: Finding;
  computer: string;
  controlBusy: boolean;
  onLive: () => void;
  onControl: (action: "take" | "release") => void;
}

/** The right of a run: the live screen, or the selected finding's evidence. */
function Stage({ run, finding, computer, controlBusy, onLive, onControl }: StageProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const onProblem = useCallback((text: string | null) => setProblem(text), []);
  // Until the live screen has connected, the last saved screen stands in for it.
  const [connected, setConnected] = useState(false);
  const onConnected = useCallback(() => setConnected(true), []);
  useEffect(() => setConnected(false), [run.stream]);

  const live = Boolean(run.stream);
  const last = run.screens.at(-1);
  const src = (name: string) => `/api/runs/${run.id}/screens/${name}`;

  if (finding) return <Evidence run={run} finding={finding} onLive={live ? onLive : undefined} />;

  const asking = run.state === "needs_input";
  return (
    <section className="stage">
      <div className="monitor" data-driver={run.driving ? "human" : undefined}>
        <header className="monitor-bar">
          <p className="now" role="status">
            {run.driving ? (
              <>
                <i className="dot" data-status="yours" />
                <span>
                  You have the controls <small>· the run waits until you hand back</small>
                </span>
              </>
            ) : asking ? (
              <>
                <i className="dot" data-status="asking" />
                <span>Waiting for you</span>
              </>
            ) : live ? (
              <>
                <i className="dot" data-status="working" />
                <span>{run.doing ?? (run.findings.length ? "Carrying on" : "Opening the browser")}</span>
              </>
            ) : working(run) ? (
              <>
                <i className="dot" data-status="working" />
                <span>{run.waiting ?? (computer === "starting" ? "Starting the Computer" : "Getting ready")}</span>
              </>
            ) : (
              <>
                <i className="dot" />
                <span>{ENDED[run.state] ?? "Ended"}</span>
              </>
            )}
          </p>
          {live ? (
            <button className={`btn sm ${run.driving ? "human" : ""}`} aria-busy={controlBusy} disabled={controlBusy} onClick={() => onControl(run.driving ? "release" : "take")}>
              <Hand /> {run.driving ? "Hand back" : "Take control"}
            </button>
          ) : null}
        </header>
        <div className="frame">
          {live ? <Desktop run={run.id} stream={run.stream!} driving={run.driving} onProblem={onProblem} onConnected={onConnected} /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {last && !(live && connected) ? <img src={src(last.name)} alt="" /> : null}
          {!last && !(live && connected) ? (
            <div className="veil">
              <h2>{working(run) ? (run.waiting ? "Waiting for a Computer" : "The screen appears here") : "No screen was saved"}</h2>
              <p>{working(run) ? (run.waiting ?? "A Computer opens a real browser and walks the flow as a user would.") : (run.summary ?? "")}</p>
            </div>
          ) : null}
        </div>
      </div>
      {problem && live ? <p className="problem">{problem}</p> : null}
      {run.screens.length ? (
        <div className="kept">
          <p className="proof">{open(run) ? "Every screen it leaves is kept. A check's evidence is chosen from these." : "The screens this run left."}</p>
          <ol className="strip latest">
            {run.screens.slice(-4).map((screen) => (
              <li key={screen.name}>
                <span className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(screen.name)} alt="" loading="lazy" />
                  <span>
                    <em>{screen.caption}</em>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
