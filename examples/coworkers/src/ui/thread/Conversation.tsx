"use client";

// A thread, as a conversation: each message a person sent, and under it the coworker's
// work on it. While a job runs, the last few steps show as they happen; once it ends
// they settle into one line, and the answer, a question or the reason it stopped is the
// coworker's message.

import { Download, Hand, Sparkles } from "lucide-react";
import { useState } from "react";
import { APPROVE, DECLINE, question, type CoworkerView, type JobView } from "@/shared/api";
import type { Item, Work } from "@/shared/fold";
import { hostOf, rows, say, stepCount, stepsIn, type Said, type StepItem } from "@/shared/steps";
import { enc } from "../common/api";
import { clock, cost, duration, kindOf, offset, size } from "../common/format";
import { Avatar, useNow } from "../common/kit";
import { Markdown } from "../common/Markdown";
import { useWorkspace } from "../app/Workspace";

export interface JobActions {
  onAnswer: (job: JobView, text: string) => Promise<boolean>;
  onStop: (job: JobView) => void;
  /** Offered on the thread's latest finished job while its session is open; `text` answers the skill author's questions. */
  onLearn?: (job: JobView, text?: string) => Promise<boolean>;
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
  const price = cost(ended ? job.cost : live?.outcome?.cost);

  return (
    <>
      <div className="said">
        <Words text={job.ask} />
        <span className="meta">
          {job.kind === "answer" ? <span>Your reply · </span> : null}
          {clock(askedAt)}
        </span>
      </div>
      <article className="msg">
        <Avatar name={coworker.name} color={coworker.color} />
        <div className="body">
          <header className="who">
            {coworker.name}
            <time>{clock(endedAt ?? askedAt)}</time>
          </header>
          {reason ? (
            <>
              <Settled items={items} startedAt={startedAt} ms={ms} price={price} />
              <Ending coworker={coworker} job={job} reason={reason} summary={summary} saved={ended} latest={latest} actions={actions} />
            </>
          ) : (
            <>
              <LiveWork items={items} startedAt={startedAt} />
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

// ---- its steps ----------------------------------------------------------------------

const CONTROL_WORDS: Record<string, string> = { human: "You took control", agent: "You handed back", locked: "Controls locked" };
const STATE_WORDS: Record<string, string> = { failed: "failed", declined: "not run", interrupted: "interrupted" };

/** What a step did: the words, then a command in mono or its site, quietly. */
function SaidText({ said }: { said: Said }) {
  return (
    <span className="t" title={said.mono ?? said.text}>
      <b>{said.text}</b>
      {said.mono ? <code>{said.mono}</code> : said.quiet ? <i>{said.quiet}</i> : null}
    </span>
  );
}

/** One step inside a folded row: the page it opened, or the command it ran. */
function inner(step: StepItem): Said {
  const said = say(step);
  if (said.mono || !step.url) return said.mono ? { text: "", mono: said.mono } : said;
  const host = hostOf(step.url);
  let path = "";
  try {
    path = new URL(step.url).pathname.replace(/\/$/, "");
  } catch {
    // not an address: the host alone
  }
  return step.page ? { text: step.page, quiet: `${host}${path}` } : { text: `${host}${path}` };
}

/** How a step, or a folded run of them, ended: the time into the job, or what went wrong. */
function ended(state: string, at: number, startedAt: number, live: boolean): string {
  // A step still running when its job ended has no outcome to show.
  const shown = state === "running" && !live ? "interrupted" : state;
  return shown === "running" ? "" : (STATE_WORDS[shown] ?? offset(at - startedAt));
}

/** A job's steps, folded: a run of the same step is one row that opens. */
function Rows({ items, startedAt }: { items: Item[]; startedAt: number }) {
  return (
    <ol className="steps">
      {rows(items).map((row) => {
        if (row.kind === "note") {
          return (
            <li key={row.item.id} data-kind="note">
              <Markdown text={row.item.text} />
            </li>
          );
        }
        if (row.kind === "steer") {
          return (
            <li key={row.item.id} data-kind="steer">
              <Words text={row.item.text} />
            </li>
          );
        }
        if (row.kind === "control") {
          return (
            <li key={row.item.id} className="step" data-kind="control">
              <i className="mark" />
              <span className="t">
                <b>{CONTROL_WORDS[row.item.who] ?? row.item.who}</b>
              </span>
              <span className="state">{offset(row.item.at - startedAt)}</span>
            </li>
          );
        }
        if (row.steps.length === 1) {
          const step = row.steps[0];
          const state = step.state === "running" ? "interrupted" : step.state;
          return (
            <li key={row.id} className="step" data-state={state}>
              <i className="mark" />
              <SaidText said={row.said} />
              <span className="state">{ended(step.state, step.at, startedAt, false)}</span>
            </li>
          );
        }
        return (
          <li key={row.id}>
            <details>
              <summary className="step">
                <i className="mark" />
                <SaidText said={row.said} />
                <span className="state">
                  {row.failed ? <span className="bad">{row.failed} failed · </span> : null}
                  {offset(row.at - startedAt)}
                </span>
              </summary>
              <ol className="steps inner">
                {row.steps.map((step) => (
                  <li key={step.id} className="step" data-state={step.state === "running" ? "interrupted" : step.state}>
                    <SaidText said={inner(step)} />
                    <span className="state">{ended(step.state, step.at, startedAt, false)}</span>
                  </li>
                ))}
              </ol>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** How many of the latest steps show while a job runs. */
const TAIL = 4;

/** A job under way: what it last said, and its last few steps as they happen. */
function LiveWork({ items, startedAt }: { items: Item[]; startedAt: number }) {
  if (!items.length) return null;
  const note = items.findLast((item) => item.kind === "note");
  const acts = items.filter((item) => item.kind !== "note");
  const tail = acts.slice(-TAIL);
  const before = items.slice(0, tail.length ? items.indexOf(tail[0]) : items.length).filter((item) => item !== note);
  const earlier = stepsIn(before).length;
  return (
    <>
      {earlier ? (
        <details className="settled earlier">
          <summary>
            {earlier} earlier {earlier === 1 ? "step" : "steps"}
          </summary>
          <Rows items={before} startedAt={startedAt} />
        </details>
      ) : null}
      {note?.kind === "note" ? <Markdown text={note.text} /> : null}
      {tail.length ? (
        <ol className="steps" aria-live="polite">
          {tail.map((item) =>
            item.kind === "steer" ? (
              <li key={item.id} data-kind="steer">
                <Words text={item.text} />
              </li>
            ) : item.kind === "control" ? (
              <li key={item.id} className="step" data-kind="control">
                <i className="mark" />
                <span className="t">
                  <b>{CONTROL_WORDS[item.who] ?? item.who}</b>
                </span>
                <span className="state">{offset(item.at - startedAt)}</span>
              </li>
            ) : item.kind === "step" ? (
              <li key={item.id} className="step" data-state={item.state}>
                <i className="mark" />
                <SaidText said={say(item, true)} />
                <span className="state">{ended(item.state, item.at, startedAt, true)}</span>
              </li>
            ) : null,
          )}
        </ol>
      ) : null}
    </>
  );
}

/** A finished job's work in one line that opens: "12 steps · 1 min 40 s · $0.08". */
function Settled({ items, startedAt, ms, price }: { items: Item[]; startedAt: number; ms: number; price: string | null }) {
  const steps = stepsIn(items).length;
  const facts = (
    <>
      {steps ? stepCount(items) : null}
      {steps && ms ? <i>·</i> : null}
      {ms ? <span className="mono">{duration(ms)}</span> : null}
      {price && (steps || ms) ? <i>·</i> : null}
      {price ? <span className="mono">{price}</span> : null}
    </>
  );
  if (!items.length) return ms || price ? <p className="facts">{facts}</p> : null;
  return (
    <details className="settled">
      <summary>{facts}</summary>
      <Rows items={items} startedAt={startedAt} />
    </details>
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
      <i className="pulse" data-status={job.state === "queued" ? "asking" : "working"} />
      {words}
      {job.state === "running" ? <time>{offset(now - startedAt)}</time> : null}
      {job.state === "queued" ? (
        <button className="btn ghost sm end" onClick={onStop}>
          Remove from queue
        </button>
      ) : null}
    </p>
  );
}

// ---- how it ended -------------------------------------------------------------------

const ENDING_WORDS: Record<string, string> = { canceled: "Stopped", failed: "Didn't finish", stopped: "Its computer stopped before it finished" };
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

/** Words that only announce a file: "Done: …", "Here is the PDF: …". */
const FILLER = /\b(?:done|here|here's|is|are|it|its|it's|the|your|you|a|an|i|i've|have|made|created|saved|attached|file|files|pdf|document|download|see|ready|finished|as|requested|link|for|to|this|one-page)\b/gi;

/**
 * The answer, unless all it does is link the files attached under it: then the
 * attachments say it, once.
 */
function answerText(summary: string, attached: (path: string) => boolean): string {
  const rest = summary.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, (link, href: string) => {
    let path = href.split(/[?#]/, 1)[0].replace(/^\.\//, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      // as written
    }
    return attached(path) ? "" : link;
  });
  return /[\p{L}\p{N}]/u.test(rest.replace(FILLER, "")) ? summary : "";
}

function Ending({ coworker, job, reason, summary, saved, latest, actions }: { coworker: CoworkerView; job: JobView; reason: string; summary: string; saved: boolean; latest: boolean; actions: JobActions }) {
  const attached = (path: string) => job.files?.some((file) => file.path === path) ?? false;
  const fileUrl = (path: string) => (attached(path) ? `/api/jobs/${enc(job.id)}/files/${path.split("/").map(enc).join("/")}` : null);

  if (reason === "needs_input" || reason === "answered") {
    const asked = question(summary);
    const open = reason === "needs_input" && job.state === "needs_input";
    return (
      <div className="ask" data-answered={open ? undefined : ""}>
        <span className="label">
          {open ? <Hand size={13} /> : null}
          {asked.approval ? (open ? "Approval needed" : "Asked for approval") : open ? "A question for you" : "Asked"}
        </span>
        <Markdown text={asked.text} fileUrl={fileUrl} />
        {open ? <Reply name={coworker.name} approval={asked.approval} onAnswer={(text) => actions.onAnswer(job, text)} onStop={() => actions.onStop(job)} /> : null}
      </div>
    );
  }

  const text = answerText(summary, attached);
  return (
    <>
      {text ? <Markdown text={text} fileUrl={fileUrl} /> : null}
      {job.files?.length ? (
        <ul className="files" aria-label="Files it made">
          {job.files.map((file) => {
            const url = fileUrl(file.path)!;
            return (
              <li key={file.path} className="file">
                {PICTURE.test(file.path) ? (
                  <a className="preview" href={`${url}?open`} target="_blank" rel="noopener noreferrer" title={`Open ${file.path}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${url}?open`} alt={file.path} loading="lazy" />
                  </a>
                ) : null}
                <div className="row">
                  <span className="kind">{kindOf(file.path)}</span>
                  <a className="path" href={`${url}?open`} target="_blank" rel="noopener noreferrer" title={`Open ${file.path}`}>
                    {file.path}
                  </a>
                  <span className="size">{size(file.size)}</span>
                  <a className="btn ghost sm icon" href={url} aria-label={`Download ${file.path}`} title="Download">
                    <Download />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {reason !== "completed" || !saved ? (
        <p className="runline">
          {reason !== "completed" ? <span>{ENDING_WORDS[reason] ?? "Didn't finish"}</span> : null}
          {!saved ? <span>Saving its work</span> : null}
        </p>
      ) : null}
      {job.learn ? (
        <LearnNote name={coworker.name} job={job} onReview={() => actions.onReview(job)} onLearn={latest && actions.onLearn ? (text) => actions.onLearn!(job, text) : undefined} />
      ) : latest && saved && reason === "completed" && actions.onLearn ? (
        <p className="runline">
          <button className="btn ghost sm" title={`Draft a skill from this job, for ${coworker.name} to reuse`} onClick={() => void actions.onLearn!(job)}>
            <Sparkles /> Save as a skill
          </button>
        </p>
      ) : null}
    </>
  );
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/\.*$/, ".");

/** The skill author's questions, and a box to answer them in: the answers start the draft again. */
function SkillQuestions({ questions, onAnswer }: { questions: string[]; onAnswer: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ask skill-asks"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        await onAnswer(text.trim());
        setBusy(false);
      }}
    >
      <span className="label">
        <Sparkles size={13} /> Before it writes the skill
      </span>
      {questions.length ? (
        <ol className="md">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      ) : (
        <p className="md">The job could be read more than one way. Say what the skill is for, and what changes from job to job.</p>
      )}
      <textarea className="textarea" rows={3} value={text} placeholder="Answer in a line or two" aria-label="Your answers" onChange={(event) => setText(event.target.value)} />
      <div className="acts">
        <button className="btn human" aria-busy={busy} disabled={busy || !text.trim()}>
          Draft the skill
        </button>
      </div>
    </form>
  );
}

/** What came of "Save as a skill": a draft under way, questions first, a draft to read, a skill in use, or why not. */
function LearnNote({ name, job, onReview, onLearn }: { name: string; job: JobView; onReview: () => void; onLearn?: (text?: string) => Promise<boolean> }) {
  const learn = job.learn!;
  if (learn.state === "asks" && onLearn) return <SkillQuestions questions={learn.questions ?? []} onAnswer={onLearn} />;
  return (
    <div className="skill-note" data-state={learn.state}>
      <span className="glyph">
        <Sparkles />
      </span>
      {learn.state === "drafting" ? (
        <span>
          <b>Drafting a skill from this job</b>
          <small>It takes a minute or three. Carry on meanwhile.</small>
        </span>
      ) : learn.state === "draft" ? (
        <>
          <span>
            <b className="mono">{learn.name}</b>
            <small>A draft. {name} doesn&apos;t use it until you activate it.</small>
          </span>
          <button className="btn sm primary" onClick={onReview}>
            Read the draft
          </button>
        </>
      ) : learn.state === "active" ? (
        <>
          <span>
            <b className="mono">{learn.name}</b>
            <small>Active. {name} uses it from its next job on.</small>
          </span>
          <button className="btn sm ghost" onClick={onReview}>
            Read
          </button>
        </>
      ) : (
        <>
          <span>
            <b>No skill came of it</b>
            <small>{learn.state === "asks" ? "The skill author had questions, and this thread's session has ended." : sentence(learn.reason ?? "Nothing in it was worth keeping")}</small>
          </span>
          {onLearn ? (
            <button className="btn sm ghost" onClick={() => void onLearn()}>
              Try again
            </button>
          ) : null}
        </>
      )}
    </div>
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
  // An approval leads with its two answers; a plain question leads with the reply, and ending the job sits beside it.
  const end = (
    <button type="button" className="btn ghost push" title="Close the question and end the job here" disabled={busy !== null} onClick={onStop}>
      End job
    </button>
  );
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
          {end}
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
        {approval ? null : end}
      </form>
    </>
  );
}
