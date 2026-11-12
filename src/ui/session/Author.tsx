"use client";

// Skills, made in the conversation: offered after a person hands back the controls
// (teach it what they showed), and on a finished task (learn from what it did). The
// authoring run is followed live; the draft waits for review in Skills.

import { GraduationCap, Hand, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HandoffView } from "@/shared/api";
import type { Outcome, WireEvent } from "@/shared/events";
import { call, errorText } from "../common/api";
import { useNow } from "../common/kit";
import { duration, hostOf } from "../common/format";

const sentence = (text: string) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : "");

export interface Authoring {
  authorId: string;
  kind: "learn" | "teach";
  goal?: string;
  handoffId?: string;
}

/** After a person hands back: turn what they showed into a skill. */
export function TeachOffer({ session, handoffId, onTeach, onClose }: { session: string; handoffId: string; onTeach: (goal: string) => Promise<void>; onClose: () => void }) {
  const [handoff, setHandoff] = useState<HandoffView | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<HandoffView>(`/api/sessions/${encodeURIComponent(session)}/handoffs/${encodeURIComponent(handoffId)}`).then(setHandoff, () => setHandoff(null));
  }, [session, handoffId]);
  const took = handoff?.startedAt && handoff.endedAt ? Date.parse(handoff.endedAt) - Date.parse(handoff.startedAt) : null;

  return (
    <div className="inline-card human">
      <header>
        <Hand style={{ color: "var(--human)" }} />
        Teach it what you just did?
        <button className="btn ghost icon sm" style={{ marginLeft: "auto" }} aria-label="Not now" onClick={onClose}>
          <X />
        </button>
      </header>
      <p>
        You drove{took ? ` for ${duration(took)}` : ""}
        {handoff?.url ? (
          <>
            {" "}
            and ended on <b>{hostOf(handoff.url)}</b>
          </>
        ) : null}
        . Say what it was, and the Computer drafts a skill its agent can reuse.
      </p>
      <input className="input" placeholder="e.g. Download this month's invoices as a CSV" value={goal} onChange={(event) => setGoal(event.target.value)} />
      <div className="row-acts">
        <button
          className="btn sm primary"
          aria-busy={busy}
          disabled={!goal.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onTeach(goal.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          <GraduationCap /> Teach it
        </button>
        <button className="btn sm ghost" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** An authoring run as it happens, then its outcome. */
export function AuthorCard({
  session,
  run,
  onClarify,
  onClose,
}: {
  session: string;
  run: Authoring;
  onClarify: (answers: string) => Promise<void>;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<{ id: string; text: string }[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [answers, setAnswers] = useState("");
  const [busy, setBusy] = useState(false);
  const [started] = useState(() => Date.now());
  const now = useNow();

  useEffect(() => {
    setLines([]);
    setOutcome(null);
    const source = new EventSource(`/api/sessions/${encodeURIComponent(session)}/author/${encodeURIComponent(run.authorId)}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WireEvent;
      if (event.outcome) setOutcome(event.outcome);
      const text = event.progress?.text ?? (event.step?.state === "running" ? undefined : event.step?.title);
      if (text) setLines((all) => [...all.filter((l) => l.id !== `s${event.step?.id}`), { id: event.step ? `s${event.step.id}` : `e${event.id}`, text }].slice(-6));
    };
    source.addEventListener("end", () => source.close());
    source.addEventListener("problem", (message) => setProblem((JSON.parse((message as MessageEvent).data) as { error: string }).error));
    return () => source.close();
  }, [session, run.authorId]);

  const cancel = async () => {
    try {
      await call(`/api/sessions/${encodeURIComponent(session)}/author/${encodeURIComponent(run.authorId)}`, { method: "DELETE" });
    } catch (error) {
      setProblem(errorText(error));
    }
    onClose();
  };

  const draft = outcome?.author?.draft;
  const questions = outcome?.reason === "clarification_requested" ? (outcome.author?.questions ?? []) : [];
  const title = run.kind === "teach" ? "Teaching a skill" : "Learning a skill from this run";

  return (
    <div className="inline-card accent">
      <header>
        <Sparkles style={{ color: "var(--accent-text)" }} />
        {outcome ? (draft ? "Skill drafted" : questions.length ? "A few questions first" : "No skill this time") : title}
        <span className="end">{outcome ? null : duration(now - started)}</span>
        {outcome ? (
          <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        ) : null}
      </header>
      {!outcome ? (
        <>
          <p>It writes the steps down as a SKILL.md on its own model. This takes a minute or three; you can keep working.</p>
          {lines.length ? (
            <div className="lines">
              {lines.map((line) => (
                <span key={line.id}>· {line.text}</span>
              ))}
            </div>
          ) : (
            <span className="live-line">
              <span className="spinner" />
              <span className="shine">Reading the run</span>
            </span>
          )}
          <div className="row-acts">
            <button className="btn sm ghost" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </>
      ) : draft ? (
        <>
          <p>
            <b className="mono">{draft.name}</b> v{draft.version} is waiting for review. Read it, then activate it: agents use it from their next task.
          </p>
          <div className="row-acts">
            <Link className="btn sm primary" href={`/skills?select=${encodeURIComponent(`${draft.name}@${draft.version}`)}`}>
              Review the draft
            </Link>
          </div>
        </>
      ) : questions.length ? (
        <>
          <ul style={{ display: "grid", gap: 4, paddingLeft: 18, fontSize: 13 }}>
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          {run.kind === "teach" ? (
            <>
              <textarea className="textarea" placeholder="Your answers" value={answers} onChange={(event) => setAnswers(event.target.value)} />
              <div className="row-acts">
                <button
                  className="btn sm primary"
                  aria-busy={busy}
                  disabled={!answers.trim() || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onClarify(answers.trim());
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Answer and teach
                </button>
              </div>
            </>
          ) : (
            <p>Teach it instead: take the controls, do it once, and hand back.</p>
          )}
        </>
      ) : (
        <p>{sentence(outcome.summary) || "It couldn't make a reusable skill from this."}</p>
      )}
      {problem ? <p className="problem">{problem}</p> : null}
    </div>
  );
}
