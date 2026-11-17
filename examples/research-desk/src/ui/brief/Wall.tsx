"use client";

// The wall: every reader's live screen side by side, each under its angle, with the
// page it is on right now. This is what "at the same time" looks like.
//
// Choosing a screen opens it large, in place: the same live connection grows, with the
// reader's steps beside it in plain words and the other readers still at work in the
// corner. There a person can take its controls (to get past a cookie wall or a sign-in,
// say) and hand them back, or answer a question it stopped on.

import { ArrowLeft, Hand } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BriefView, ReaderView, RunView } from "@/shared/api";
import type { Item } from "@/shared/fold";
import { sameAs } from "@/shared/notes";
import { doing, hostOf, rows, stepsIn } from "@/shared/steps";
import { call, enc } from "../common/api";
import { count } from "../common/format";
import { useDesk } from "../app/Desk";
import { Desktop } from "./Desktop";

export const shotUrl = (run: string, name: string) => "/api/runs/" + enc(run) + "/shots/" + enc(name);

const ACTIVE = new Set(["starting", "running", "canceling"]);

/** The pages a run's browser has been on, each once, oldest first. */
function opened(items: readonly Item[]): { url: string; host: string; title: string }[] {
  const pages: { url: string; host: string; title: string }[] = [];
  for (const step of stepsIn(items)) {
    if (step.type !== "browser" || !hostOf(step.url)) continue;
    const known = pages.find((p) => sameAs(p.url) === sameAs(step.url!));
    if (!known) pages.push({ url: step.url!, host: hostOf(step.url), title: step.page ?? "" });
    else if (!known.title && step.page) known.title = step.page;
  }
  return pages;
}

/** What a reader is doing, in a line: its state's tone, and the words. */
function status(run: RunView | undefined, items: readonly Item[], name: string): { tone: "working" | "yours" | "ok" | "bad" | "idle"; text: string } {
  if (!run) return { tone: "idle", text: "Not started" };
  if (run.driving) return { tone: "yours", text: "You have the controls. " + name + " waits." };
  switch (run.state) {
    case "queued":
      return { tone: "idle", text: run.waiting || "Waiting for a computer" };
    case "starting":
      return { tone: "working", text: run.live ? "Opening its browser" : "Starting " + name + "'s computer" };
    case "running":
    case "canceling":
      return { tone: "working", text: doing(items) ?? "Starting to read" };
    case "needs_input":
      return { tone: "yours", text: "It has a question for you" };
    case "completed":
      return { tone: "ok", text: "Done · " + count(run.pages ?? 0, "page") + " opened" + (run.dropped ? " · " + count(run.dropped, "claim") + " left out" : "") };
    default:
      return { tone: "bad", text: run.problem || "Stopped before it finished" };
  }
}

/** A reader's screen: live while its session is open, and the last picture of it after. */
function Screen({ run, driving }: { run: RunView | undefined; driving: boolean }) {
  const [connected, setConnected] = useState<string | null>(null);
  const live = run?.live ?? null;
  return (
    <div className="frame" data-driving={driving || undefined}>
      {run && live ? <Desktop run={run.id} live={live} driving={driving} onConnected={() => setConnected(live)} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {run?.lastShot && (!live || connected !== live) ? <img src={shotUrl(run.id, run.lastShot)} alt="" /> : null}
    </div>
  );
}

interface WallProps {
  brief: BriefView;
  /** The live stream's steps, by run. */
  work: Map<string, Item[]>;
  readers: ReaderView[];
  /** The angle whose reader is opened large. */
  open: string | null;
  onOpen: (angle: string | null) => void;
}

export function Wall({ brief, work, readers, open, onOpen }: WallProps) {
  const { act } = useDesk();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");

  const tiles = brief.angles.map((angle, i) => {
    const run = brief.runs.find((r) => r.kind === "read" && r.angle === angle.id);
    const items = run?.items ?? (run ? work.get(run.id) : undefined) ?? [];
    const reader = readers.find((r) => r.id === run?.reader);
    const name = reader?.name ?? "Reader " + (i + 1);
    return { angle, n: i + 1, run, items, name, said: status(run, items, name), pages: opened(items) };
  });
  const main = tiles.find((tile) => tile.angle.id === open);
  const live = Boolean(main?.run && ACTIVE.has(main.run.state));
  const list = main ? rows(main.items, live) : [];

  // Keep the newest step in view.
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [list.length, open]);

  const control = async (run: RunView, action: "take" | "release") => {
    setBusy(true);
    await act(() => call("/api/runs/" + enc(run.id) + "/control", { body: { action } }));
    setBusy(false);
  };

  return (
    <section className="wall" data-count={tiles.length} data-opened={main ? "" : undefined}>
      {tiles.map(({ angle, n, run, said, pages, name }) => {
        const isOpen = main?.angle.id === angle.id;
        return (
          <article key={angle.id} className="tile" data-tone={said.tone} data-open={isOpen || undefined}>
            <header>
              <span className="n">{n}</span>
              <h2>{angle.title}</h2>
              {isOpen && run?.live ? (
                <button className={"btn sm " + (run.driving ? "human" : "")} aria-busy={busy} disabled={busy} onClick={() => void control(run, run.driving ? "release" : "take")}>
                  <Hand /> {run.driving ? "Hand back" : "Take the controls"}
                </button>
              ) : null}
            </header>
            {/* Watching only: a click opens the reader, and reaches its screen only while a person drives. */}
            <div
              className="screen"
              role={isOpen ? undefined : "button"}
              tabIndex={isOpen ? undefined : 0}
              aria-label={isOpen ? undefined : "Open " + name + ": " + angle.title}
              onClick={isOpen ? undefined : () => onOpen(angle.id)}
              onKeyDown={isOpen ? undefined : (event) => (event.key === "Enter" || event.key === " ") && onOpen(angle.id)}
            >
              <Screen run={run} driving={isOpen && Boolean(run?.driving)} />
            </div>
            <p className="doing" role="status">
              <i className="dot" data-status={said.tone} />
              <span>{said.text}</span>
            </p>
            {/* The page it is on now, then the ones before it. */}
            <ul className="pages" data-live={run?.state === "running" || undefined}>
              {pages
                .slice(-4)
                .reverse()
                .map((page) => (
                  <li key={page.url}>
                    <b>{page.host}</b>
                    <span>{page.title}</span>
                  </li>
                ))}
            </ul>
          </article>
        );
      })}

      {main ? (
        <aside className="side">
          <button className="btn ghost sm back" onClick={() => onOpen(null)}>
            <ArrowLeft /> All readers
          </button>
          <div className="side-on">
            <p className="label">
              {main.name} · {live ? "reading now" : "last read"}
            </p>
            {main.pages.length ? (
              <>
                <h3>{main.pages.at(-1)!.title || main.pages.at(-1)!.host}</h3>
                <p className="host">{main.pages.at(-1)!.host}</p>
              </>
            ) : (
              <h3 className="quiet">Nothing opened yet</h3>
            )}
          </div>
          {main.run?.question ? (
            <form
              className="ask"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!reply.trim() || !main.run) return;
                setBusy(true);
                await act(() => call("/api/runs/" + enc(main.run!.id) + "/answer", { body: { text: reply.trim() } }));
                setReply("");
                setBusy(false);
              }}
            >
              <p className="label">It asks</p>
              <p>{main.run.question}</p>
              <div>
                <input className="input" aria-label="Your reply" placeholder="Reply" value={reply} onChange={(event) => setReply(event.target.value)} />
                <button className="btn human sm" disabled={busy || !reply.trim()}>
                  Send
                </button>
              </div>
            </form>
          ) : null}
          <p className="label">
            Its steps · {count(main.pages.length, "page")} opened
          </p>
          <ol className="steps" ref={log}>
            {list.map((row) =>
              row.kind === "control" ? (
                <li key={row.id} data-kind="control">
                  <i className="mark" />
                  <span>{row.who === "human" ? "You took the controls" : "You handed the controls back"}</span>
                </li>
              ) : (
                <li key={row.id} data-state={row.state}>
                  <i className="mark" />
                  <span>
                    {row.said.text}
                    {row.times > 1 ? <small> ×{row.times}</small> : null}
                    {row.said.quiet ? <em> {row.said.quiet}</em> : null}
                  </span>
                </li>
              ),
            )}
          </ol>
        </aside>
      ) : null}
    </section>
  );
}
