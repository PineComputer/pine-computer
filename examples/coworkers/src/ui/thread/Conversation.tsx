"use client";

// A thread, as a conversation: each message a person sent, and under it the coworker's
// work on it. While a job runs its steps arrive live; once it ends they settle into one
// line and the answer, a question or the reason it stopped is the coworker's message.

import { Download, Sparkles } from "lucide-react";
import { useState } from "react";
import { brand } from "@/brand";
import { APPROVE, DECLINE, question, type CoworkerView, type JobView } from "@/shared/api";
import { stepCount, type Item, type Work } from "@/shared/fold";
import { enc } from "../common/api";
import { clock, cost, duration, hostOf, kindOf, offset, size } from "../common/format";
import { Avatar, useNow } from "../common/kit";
import { Markdown } from "../common/Markdown";
import { useWorkspace } from "../app/Workspace";

export interface JobActions {
  onAnswer: (job: JobView, text: string) => Promise<boolean>;
  onStop: (job: JobView) => void;
  /** Offered on the thread's latest finished job while its session is open. */
  onLearn?: (job: JobView) => void;
  onReview: (job: JobView) => void;
}

export function Conversation({ coworker, jobs, work, actions }: { coworker: CoworkerView; jobs: JobView[]; work: Map<string, Work>; actions: JobActions }) {
  const last = jobs.at(-1);
  return (
    <>
      {jobs.map((job) => (
        <JobMessages key={job.id} coworker={coworker} job={job} live={job.turnId ? work.get(job.turnId) : undefined} latest={job === last} actions={actions} />
      ))}
    </>
  );
}

function JobMessages({ coworker, job, live, latest, actions }: { coworker: CoworkerView; job: JobView; live?: Work; latest: boolean; actions: JobActions }) {
  const askedAt = Date.parse(job.askedAt);
  // The record is the truth once the job has ended; until then, the live stream is.
  const ended = job.endedAt !== undefined;
  const items = job.items ?? live?.items ?? [];
  const reason = ended ? job.state : live?.outcome?.reason;
  const summary = (ended ? job.summary : live?.outcome?.summary) ?? "";
  const endedAt = job.endedAt ? Date.parse(job.endedAt) : live?.outcome?.at;
  const ms = job.durationMs ?? live?.outcome?.durationMs ?? (endedAt ? endedAt - askedAt : 0);
  const startedAt = live?.startedAt ?? askedAt;

  return (
    <>
      <article className="msg">
        <span className="avatar you">{brand.you[0]}</span>
        <div className="body">
          <header className="who">
            {brand.you}
            {job.kind === "answer" ? <span className="muted">replied</span> : null}
            <time>{clock(askedAt)}</time>
          </header>
          <Words text={job.ask} />
        </div>
      </article>
      <article className="msg">
        <Avatar name={coworker.name} color={coworker.color} />
        <div className="body">
          <header className="who">
            {coworker.name}
            <time>{clock(endedAt ?? askedAt)}</time>
          </header>
          {reason ? (
            <>
              {items.length ? (
                <details className="settled">
                  <summary>
                    {stepCount(items)} · {duration(ms)}
                  </summary>
                  <Steps items={items} startedAt={startedAt} live={false} />
                </details>
              ) : null}
              <Ending coworker={coworker} job={job} reason={reason} summary={summary} saved={ended} latest={latest} actions={actions} />
            </>
          ) : (
            <>
              <Steps items={items} startedAt={startedAt} live />
              <Waiting coworker={coworker} job={job} startedAt={startedAt} onStop={() => actions.onStop(job)} />
            </>
          )}
        </div>
      </article>
    </>
  );
}

/** A person's words, with each vault secret shown by its name only. */
function Words({ text }: { text: string }) {
  const { ws } = useWorkspace();
  const names = new Set(ws.secrets.map((s) => `$${s.name}`));
  return (
    <p className="words">
      {text.split(/(\$[A-Za-z_][A-Za-z0-9_]*)/).map((part, i) =>
        names.has(part) ? (
          <span key={i} className="secret" title="A secret from the vault: the coworker uses it without seeing it">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

const STATE_WORDS: Record<string, string> = { running: "running", failed: "failed", declined: "not run", interrupted: "interrupted" };
const CONTROL_WORDS: Record<string, string> = { human: "You took control", agent: "You handed back", locked: "Controls locked" };

function Steps({ items, startedAt, live }: { items: Item[]; startedAt: number; live: boolean }) {
  if (!items.length) return null;
  return (
    <ol className="steps">
      {items.map((item) => {
        if (item.kind === "note") {
          return (
            <li key={item.id} data-kind="note">
              <Markdown text={item.text} />
            </li>
          );
        }
        if (item.kind === "steer") {
          return (
            <li key={item.id} data-kind="steer">
              <Words text={item.text} />
            </li>
          );
        }
        if (item.kind === "control") {
          return (
            <li key={item.id} data-kind="control">
              <i className="mark" />
              <span className="t">{CONTROL_WORDS[item.who] ?? item.who}</span>
              <span className="state">{offset(item.at - startedAt)}</span>
            </li>
          );
        }
        // A step still running when its job ended has no outcome to show.
        const state = item.state === "running" && !live ? "interrupted" : item.state;
        return (
          <li key={item.id} data-state={state}>
            <i className="mark" />
            <span className="t" title={item.title}>
              {item.title}
              {item.url ? <span className="host">{hostOf(item.url)}</span> : null}
            </span>
            <span className="state">{STATE_WORDS[state] ?? offset(item.at - startedAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A job that hasn't ended: in the queue, waiting for its Computer, or at work. */
function Waiting({ coworker, job, startedAt, onStop }: { coworker: CoworkerView; job: JobView; startedAt: number; onStop: () => void }) {
  const now = useNow();
  const words =
    job.state === "queued"
      ? `Queued. ${job.waiting ?? ""}`
      : job.state === "starting"
        ? coworker.computer === "starting"
          ? `Starting ${coworker.name}'s computer`
          : "Opening the thread on its computer"
        : job.state === "canceling"
          ? "Stopping"
          : "Working";
  return (
    <p className="status-line">
      <i className="dot" data-status={job.state === "queued" ? "asking" : "working"} />
      {words}
      {job.state === "running" ? <span className="mono muted">{offset(now - startedAt)}</span> : null}
      {job.state === "queued" ? (
        <button className="btn ghost sm end" onClick={onStop}>
          Remove from queue
        </button>
      ) : null}
    </p>
  );
}

const ENDING_WORDS: Record<string, string> = { canceled: "Stopped", failed: "Didn't finish", stopped: "Its computer stopped before it finished" };

function Ending({ coworker, job, reason, summary, saved, latest, actions }: { coworker: CoworkerView; job: JobView; reason: string; summary: string; saved: boolean; latest: boolean; actions: JobActions }) {
  const fileUrl = (path: string) => (job.files?.some((file) => file.path === path) ? `/api/jobs/${enc(job.id)}/files/${path.split("/").map(enc).join("/")}` : null);

  if (reason === "needs_input" || reason === "answered") {
    const asked = question(summary);
    const open = reason === "needs_input" && job.state === "needs_input";
    return (
      <div className="ask" data-answered={open ? undefined : ""}>
        <span className="label">{asked.approval ? "Approval" : "Question"}</span>
        <Markdown text={asked.text} fileUrl={fileUrl} />
        {open ? <Reply name={coworker.name} approval={asked.approval} onAnswer={(text) => actions.onAnswer(job, text)} onStop={() => actions.onStop(job)} /> : null}
      </div>
    );
  }

  const price = cost(job.cost);
  return (
    <>
      {summary ? <Markdown text={summary} fileUrl={fileUrl} /> : null}
      {job.files?.length ? (
        <ul className="files" aria-label="Files it made">
          {job.files.map((file) => {
            const url = fileUrl(file.path)!;
            return (
              <li key={file.path} className="file">
                <span className="kind">{kindOf(file.path)}</span>
                <a className="path" href={`${url}?open`} target="_blank" rel="noopener noreferrer" title={`Open ${file.path}`}>
                  {file.path}
                </a>
                <span className="size">{size(file.size)}</span>
                <a className="btn ghost sm icon" href={url} aria-label={`Download ${file.path}`} title="Download">
                  <Download />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="runline">
        {reason !== "completed" ? <span>{ENDING_WORDS[reason] ?? "Didn't finish"}</span> : null}
        {price ? <span className="mono">{price}</span> : null}
        {!saved ? <span>Saving its work</span> : null}
        {job.learn ? (
          <LearnNote job={job} onReview={() => actions.onReview(job)} />
        ) : latest && saved && reason === "completed" && actions.onLearn ? (
          <button className="btn ghost sm" title={`Draft a skill from this job, for ${coworker.name} to reuse`} onClick={() => actions.onLearn!(job)}>
            <Sparkles /> Save as a skill
          </button>
        ) : null}
      </div>
    </>
  );
}

function LearnNote({ job, onReview }: { job: JobView; onReview: () => void }) {
  const learn = job.learn!;
  return (
    <span className="skill-note">
      <Sparkles />
      {learn.state === "drafting" ? (
        "Drafting a skill from this job. It takes a minute or three."
      ) : learn.state === "draft" ? (
        <>
          Skill drafted: <b className="mono">{learn.name}</b>
          <button className="btn sm" onClick={onReview}>
            Read and activate
          </button>
        </>
      ) : learn.state === "active" ? (
        <>
          Skill active: <b className="mono">{learn.name}</b>
        </>
      ) : (
        `No skill came of it. ${learn.reason ?? ""}`
      )}
    </span>
  );
}

/** The reply box under a question; an approval gets one-tap Approve and Decline too. The reply continues the same job. */
function Reply({ name, approval, onAnswer, onStop }: { name: string; approval: boolean; onAnswer: (text: string) => Promise<boolean>; onStop: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (words: string, which: string) => {
    if (!words.trim() || busy) return;
    setBusy(which);
    if (await onAnswer(words.trim())) setText("");
    setBusy(null);
  };
  return (
    <>
      {approval ? (
        <div className="acts">
          <button className="btn human" aria-busy={busy === "approve"} disabled={busy !== null} onClick={() => void send(APPROVE, "approve")}>
            Approve
          </button>
          <button className="btn" aria-busy={busy === "decline"} disabled={busy !== null} onClick={() => void send(DECLINE, "decline")}>
            Decline
          </button>
        </div>
      ) : null}
      <form
        className="reply"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text, "reply");
        }}
      >
        <input className="input" value={text} placeholder={approval ? `Or tell ${name} what to change` : `Reply to ${name}`} aria-label={`Reply to ${name}`} onChange={(event) => setText(event.target.value)} />
        <button className="btn" aria-busy={busy === "reply"} disabled={busy !== null || !text.trim()}>
          Reply
        </button>
        <button type="button" className="btn ghost" title="Close the question and end the job here" disabled={busy !== null} onClick={onStop}>
          End job
        </button>
      </form>
    </>
  );
}
