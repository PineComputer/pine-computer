"use client";

import { ArrowRight, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionView } from "@/shared/api";
import { call, enc, errorText } from "../common/api";

interface Diagnostic {
  id: string;
  /** queued | running | completed | failed */
  state: string;
  assessment?: { code: string; message: string; evidence: string; actions: { code: string; message: string }[] };
}

const DONE = new Set(["completed", "failed"]);

/**
 * Asks Pine to look the Computer over: a read-only check of its sandbox (and one
 * session's recorded work) that comes back with what's wrong and what to do about it.
 */
export function HealthCard({ sessions }: { sessions: SessionView[] }) {
  const [description, setDescription] = useState("");
  const [session, setSession] = useState("");
  const [check, setCheck] = useState<Diagnostic | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const checking = check !== null && !DONE.has(check.state);

  // A check runs on its own; read it every couple of seconds until it's done.
  useEffect(() => {
    if (!check || DONE.has(check.state)) return;
    const timer = setTimeout(() => {
      call<Diagnostic>(`/api/computer/diagnostics/${enc(check.id)}`).then(setCheck, (error) => {
        setProblem(errorText(error));
        setCheck(null);
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [check]);

  const start = async () => {
    setStarting(true);
    setProblem(null);
    try {
      setCheck(await call<Diagnostic>("/api/computer/diagnostics", { body: { description, session: session || undefined } }));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setStarting(false);
    }
  };

  const assessment = check?.assessment;
  return (
    <section className="card">
      <div className="card-head">
        <Stethoscope size={15} className="muted" />
        <h2>Health check</h2>
      </div>
      <div className="card-body">
        <label className="field">
          <span>What&apos;s wrong? (optional)</span>
          <textarea
            className="textarea"
            rows={3}
            placeholder="The agent keeps getting stuck on the sign-in page…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Look at</span>
          <select className="select" value={session} onChange={(event) => setSession(event.target.value)}>
            <option value="">The whole Computer</option>
            {sessions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}&apos;s recorded work
              </option>
            ))}
          </select>
        </label>
        <div className="cv-save">
          <button className="btn" aria-busy={starting} disabled={starting || checking} onClick={() => void start()}>
            Run a check
          </button>
          <small>Read-only: it changes nothing on the Computer.</small>
        </div>

        {problem ? <p className="problem">{problem}</p> : null}

        {checking ? (
          <div className="cv-checking">
            <span className="spinner" /> {check.state === "queued" ? "Waiting to start…" : "Looking it over…"}
          </div>
        ) : null}

        {check && DONE.has(check.state) ? (
          assessment ? (
            <div className="cv-assessment">
              <header>
                <span className="dot" data-tone={assessment.actions.length ? "human" : "ok"} />
                <strong>{assessment.message}</strong>
                <span className="badge mono" style={{ marginLeft: "auto" }}>
                  {assessment.code}
                </span>
              </header>
              {assessment.evidence ? <div className="cv-evidence">{assessment.evidence}</div> : null}
              {assessment.actions.length ? (
                <ul className="cv-fixes" aria-label="What to do">
                  {assessment.actions.map((action) => (
                    <li key={action.code} title={action.code}>
                      <ArrowRight />
                      {action.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="problem">The check {check.state === "failed" ? "couldn't finish" : "finished without an assessment"}. Try again in a moment.</p>
          )
        ) : null}
      </div>
    </section>
  );
}
