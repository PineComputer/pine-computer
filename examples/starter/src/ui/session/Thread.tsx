"use client";

import { CalendarClock, Paperclip, Sparkles } from "lucide-react";
import { brand } from "@/brand";
import type { TurnView } from "@/shared/api";
import { clock, cost, duration, kindOf, offset, size } from "../common/format";
import { Markdown } from "../common/Markdown";
import type { Turn } from "./fold";
import { film, pieces, rows, tally, type Item, type Row } from "./fold";

type Peek = (src: string, title: string) => void;

const FILM = 5;

export interface ThreadProps {
  /** This session's turns, drawn from its live events. */
  turns: Turn[];
  /** The turns this app kept: they outlive the Computer's session. */
  saved: TurnView[];
  running: boolean;
  onPeek: Peek;
  /** Offered on the latest finished task: author a skill from it. */
  onLearn?: () => void;
}

export function Thread({ turns, saved, running, onPeek, onLearn }: ThreadProps) {
  const live = new Set(turns.map((turn) => turn.id));
  // Turns from earlier sandboxes (before a Stop) are only in this app's records.
  const earlier = saved.filter((record) => !live.has(record.turnId));
  const byId = new Map(saved.map((record) => [record.turnId, record]));
  const last = turns[turns.length - 1];
  const learnable = last?.outcome?.reason === "completed" ? last.id : null;
  return (
    <>
      {earlier.map((record) => (
        <TurnView key={record.turnId} saved={record} live={false} onPeek={onPeek} />
      ))}
      {earlier.length && turns.length ? <div className="earlier">Now</div> : null}
      {turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          saved={byId.get(turn.id)}
          live={running && turn === last && !turn.outcome}
          onPeek={onPeek}
          onLearn={turn.id === learnable ? onLearn : undefined}
        />
      ))}
    </>
  );
}

function TurnView({ turn, saved, live, onPeek, onLearn }: { turn?: Turn; saved?: TurnView; live: boolean; onPeek: Peek; onLearn?: () => void }) {
  const turnId = turn?.id ?? saved!.turnId;
  const ask = turn?.ask ?? (saved?.ask ? { kind: saved.kind, text: saved.ask, at: Date.parse(saved.askedAt) } : undefined);
  const startedAt = turn?.startedAt ?? Date.parse(saved!.askedAt);
  const fileUrl = (path: string) =>
    saved?.files?.some((file) => file.path === path) ? `/api/turns/${encodeURIComponent(turnId)}/files/${path.split("/").map(encodeURIComponent).join("/")}` : null;
  const scheduled = saved?.kind === "schedule";

  return (
    <>
      {ask ? (
        <article className="msg you">
          <header className="who">
            <span className="avatar">{scheduled ? <CalendarClock size={12} /> : "Y"}</span>
            {scheduled ? "Scheduled" : "You"}
            {ask.kind === "answer" ? <span className="muted">answered</span> : null}
            <time>{clock(ask.at)}</time>
          </header>
          <p className="words">{ask.text}</p>
          {saved?.attachments?.length ? (
            <div className="chips">
              {saved.attachments.map((name) => (
                <span key={name} className="chip">
                  <Paperclip /> {name}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
      {turn
        ? pieces(turn).map((piece) =>
            piece.kind === "work" ? (
              <Work key={piece.items[0].id} items={piece.items} since={piece.since} startedAt={startedAt} live={live} onPeek={onPeek} />
            ) : piece.kind === "steer" ? (
              <article key={piece.item.id} className="msg you">
                <header className="who">
                  <span className="avatar">Y</span>
                  You<span className="muted">while it worked</span>
                  <time>{clock(piece.item.at)}</time>
                </header>
                <p className="words">{piece.item.text}</p>
              </article>
            ) : (
              <div key={piece.item.id} className="note-alone">
                <Markdown text={piece.item.text} fileUrl={fileUrl} />
              </div>
            ),
          )
        : null}
      {live && !turn?.items.length ? (
        <p className="live-line">
          <span className="dot" data-tone="agent" />
          <span className="shine">Getting started</span>
        </p>
      ) : null}
      <Outcome turn={turn} saved={saved} fileUrl={fileUrl} onLearn={onLearn} />
    </>
  );
}

function Work({ items, since, startedAt, live, onPeek }: { items: Item[]; since: number; startedAt: number; live: boolean; onPeek: Peek }) {
  const list = rows(items);
  const said = tally(list);
  const shots = film(list);
  const end = Math.max(...items.map((item) => (item.kind === "step" && item.endedAt) || item.at));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <details className="work" open={live || undefined}>
        <summary>
          {live ? (
            <span className="live-line">
              <span className="dot" data-tone="agent" />
              <span className="shine">Working</span>
            </span>
          ) : (
            <span>Worked for {duration(end - since)}</span>
          )}
          {said ? <span className="n">{said}</span> : null}
        </summary>
        <ol className="steps">
          {list.map((row) => (
            <RowView key={rowKey(row)} row={row} startedAt={startedAt} live={live} onPeek={onPeek} />
          ))}
        </ol>
      </details>
      {shots.length ? (
        <div className="film" role="group" aria-label="Screens from this work">
          {shots.slice(0, shots.length > FILM ? FILM - 1 : FILM).map(({ frame, title }) => (
            <Thumb key={frame.id} src={frame.src} title={title} onPeek={onPeek} />
          ))}
          {shots.length > FILM ? <span className="thumb more">+{shots.length - FILM + 1}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const rowKey = (row: Row) => (row.kind === "visit" ? row.stepIds[0] : row.item.id);

const OUTCOME_WORDS: Record<string, string> = { failed: "Failed", declined: "Not run", interrupted: "Interrupted" };

function RowView({ row, startedAt, live, onPeek }: { row: Row; startedAt: number; live: boolean; onPeek: Peek }) {
  if (row.kind === "note") {
    return (
      <li data-kind="note">
        <Markdown text={row.item.text} />
        <time>{offset(row.item.at - startedAt)}</time>
      </li>
    );
  }
  if (row.kind === "control") {
    return (
      <li data-kind="control">
        <span>{row.item.text}</span>
        <time>{offset(row.item.at - startedAt)}</time>
      </li>
    );
  }
  if (row.kind === "visit") {
    // A step still running when its turn ended has no outcome to show.
    const state = row.state === "running" && !live ? "interrupted" : row.state;
    return (
      <li data-state={state}>
        <div>
          {row.continued ? null : (
            <>
              {row.url ? (
                <a className="visit-title" href={row.url} target="_blank" rel="noopener noreferrer">
                  {row.title}
                </a>
              ) : (
                <span className="visit-title">{row.title}</span>
              )}
              {row.site ? <span className="visit-site">{row.site}</span> : null}
            </>
          )}
          <ul className="acts-list" aria-label={`What it did on ${row.title}`}>
            {row.actions.map((action, i) => (
              <li key={i} data-state={action.state}>
                {action.text}
                {action.times > 1 ? <span className="times">×{action.times}</span> : null}
                {OUTCOME_WORDS[action.state] ? <span className="outcome">{OUTCOME_WORDS[action.state]}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="side-col">
          <time>{offset(row.at - startedAt)}</time>
          {row.frame ? <Thumb src={row.frame.src} title={row.title} onPeek={onPeek} /> : null}
        </div>
      </li>
    );
  }
  const { step, frames, at } = row.item;
  const state = step.state === "running" && !live ? "interrupted" : step.state;
  const frame = frames[frames.length - 1];
  return (
    <li data-state={state}>
      <span>
        {step.kind === "skill" ? <Sparkles size={12} style={{ marginRight: 6, color: "var(--accent-text)", verticalAlign: -1 }} /> : null}
        {step.title}
        {OUTCOME_WORDS[state] ? <span className="muted"> · {OUTCOME_WORDS[state]}</span> : null}
      </span>
      <div className="side-col">
        <time>{offset(at - startedAt)}</time>
        {frame ? <Thumb src={frame.src} title={step.title} onPeek={onPeek} /> : null}
      </div>
    </li>
  );
}

function Thumb({ src, title, onPeek }: { src: string; title: string; onPeek: Peek }) {
  return (
    <button type="button" className="thumb" aria-label={`Show the screen after ${title}`} onClick={() => onPeek(src, title)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the stream */}
      <img src={src} alt="" />
    </button>
  );
}

function Outcome({ turn, saved, fileUrl, onLearn }: { turn?: Turn; saved?: TurnView; fileUrl: (path: string) => string | null; onLearn?: () => void }) {
  const reason = turn?.outcome?.reason ?? (saved && saved.state !== "running" && saved.state !== "canceling" ? saved.state : undefined);
  if (!reason) return null;
  const summary = turn?.outcome?.summary ?? saved?.summary ?? "";
  const at = turn?.outcome?.at ?? (saved?.endedAt ? Date.parse(saved.endedAt) : Date.now());
  const ms = turn?.outcome?.durationMs ?? saved?.durationMs ?? 0;
  const price = cost(turn?.outcome?.cost ?? saved?.cost);
  const returned = turn?.outcome?.files ?? saved?.files ?? [];

  if (reason === "needs_input" || reason === "answered") {
    return (
      <article className="msg question">
        <header className="who">
          <span className="avatar agent">{brand.agent[0]}</span>
          {brand.agent}
          <span className="badge human">{reason === "answered" ? "Asked" : "Needs your answer"}</span>
          <time>{clock(at)}</time>
        </header>
        <Markdown text={summary} fileUrl={fileUrl} />
      </article>
    );
  }

  const completed = reason === "completed";
  const word = completed ? "Done" : reason.startsWith("cancel") ? "Canceled" : reason === "stopped" ? "Stopped with the Computer" : "Didn't finish";
  return (
    <article className={completed && summary ? "msg answer" : "msg"}>
      {summary ? (
        <>
          <header className="who">
            <span className="avatar agent">{brand.agent[0]}</span>
            {brand.agent}
            <time>{clock(at)}</time>
          </header>
          <Markdown text={summary} fileUrl={fileUrl} />
        </>
      ) : null}
      {returned.length ? (
        <ul className="files" aria-label="Files it returned">
          {returned.map((file) => {
            const url = fileUrl(file.path);
            const slash = file.path.lastIndexOf("/");
            const body = (
              <>
                <span className="kind">{kindOf(file.path)}</span>
                <span className="path">
                  {slash > 0 ? <span className="folder">{file.path.slice(0, slash + 1)}</span> : null}
                  <span className="name">{file.path.slice(slash + 1)}</span>
                </span>
                <span className="size">{url ? size(file.size) : "Saving…"}</span>
              </>
            );
            return <li key={file.path}>{url ? <a href={url}>{body}</a> : <span className="file">{body}</span>}</li>;
          })}
        </ul>
      ) : null}
      <div className="runline">
        <span className={`badge ${completed ? "accent" : reason === "failed" ? "bad" : ""}`}>{word}</span>
        <span>{[ms ? duration(ms) : null, price].filter(Boolean).join(" · ")}</span>
        <span className="actions-end">
          {onLearn ? (
            <button className="btn ghost sm" onClick={onLearn} title="Turn this run into a skill the agent can reuse">
              <Sparkles /> Save as skill
            </button>
          ) : null}
        </span>
      </div>
    </article>
  );
}
