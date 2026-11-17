"use client";

// The report: a short answer, a section per angle, and its numbered sources. Every
// source is a page a reader opened, kept with the picture of its screen there, so a
// citation opens what the reader saw.

import { ArrowLeft, ArrowRight, Download, ExternalLink, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BriefView, ReaderView, Report as ReportData, Source } from "@/shared/api";
import { enc } from "../common/api";
import { count } from "../common/format";
import { shotUrl } from "./Wall";

/** The writer's words. A citation, [3], is a button that opens its source; raw HTML is never rendered. */
export function Cited({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ alt }) => <>{alt}</>,
        a: ({ href = "", children }) => {
          const n = /^#source-(\d+)$/.exec(href)?.[1];
          if (n) {
            return onCite ? (
              <button className="cite" onClick={() => onCite(Number(n))} aria-label={"Source " + n}>
                {n}
              </button>
            ) : (
              <sup>[{n}]</sup>
            );
          }
          return /^https?:\/\//i.test(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          );
        },
      }}
    >
      {text.replace(/\[(\d+)\]/g, "[$1](#source-$1)")}
    </ReactMarkdown>
  );
}

export function Report({ brief, report, readers }: { brief: BriefView; report: ReportData; readers: ReaderView[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const source = report.sources.find((s) => s.n === viewing);
  const readerCount = new Set(report.sources.map((s) => s.reader)).size;
  const base = "/api/briefs/" + enc(brief.id);

  return (
    <div className="report">
      <article className="paper">
        <header>
          <p className="label">
            Report · {count(report.sources.length, "source")} · {count(readerCount, "reader")}
          </p>
          <h2>{report.title || brief.question}</h2>
          <div className="export">
            <a className="btn sm" href={base + "/report"} download>
              <Download /> Markdown
            </a>
            <a className="btn sm" href={"/print/" + enc(brief.id) + "?print=1"} target="_blank" rel="noopener">
              <Printer /> PDF
            </a>
          </div>
        </header>
        <section className="answer">
          <Cited text={report.answer} onCite={setViewing} />
        </section>
        {report.sections.map((section) => (
          <section key={section.angle} className="md">
            <h3>{section.title}</h3>
            <Cited text={section.body} onCite={setViewing} />
          </section>
        ))}
      </article>
      <aside className="sources">
        <header>
          <h3>Sources</h3>
          <p>The pages the readers opened, as they saw them.</p>
        </header>
        <ol>
          {report.sources.map((s) => (
            <li key={s.n}>
              <button onClick={() => setViewing(s.n)} aria-label={"Source " + s.n + ": " + s.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shotUrl(s.run, s.shot)} alt="" loading="lazy" />
                <span className="cap">
                  <i>{s.n}</i>
                  <b>{s.host}</b>
                  <span>{s.title}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      {source ? (
        <SourceSheet
          source={source}
          total={report.sources.length}
          angle={brief.angles.find((a) => a.id === source.angle)?.title ?? ""}
          reader={readers.find((r) => r.id === source.reader)?.name ?? "A reader"}
          onShow={setViewing}
        />
      ) : null}
    </div>
  );
}

/** One source, opened: the reader's screen on that page, large. */
function SourceSheet({ source, total, angle, reader, onShow }: { source: Source; total: number; angle: string; reader: string; onShow: (n: number | null) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onShow(null);
      if (event.key === "ArrowLeft" && source.n > 1) onShow(source.n - 1);
      if (event.key === "ArrowRight" && source.n < total) onShow(source.n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source.n, total, onShow]);

  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onShow(null)}>
      <figure className="sheet" role="dialog" aria-modal="true" aria-label={"Source " + source.n}>
        <figcaption>
          <i className="num">{source.n}</i>
          <div>
            <h2>{source.title}</h2>
            <p>
              <b>{source.host}</b> · opened by {reader} for &ldquo;{angle}&rdquo;
            </p>
          </div>
          <div className="end">
            <button className="btn ghost sm icon" disabled={source.n <= 1} onClick={() => onShow(source.n - 1)} aria-label="Previous source">
              <ArrowLeft />
            </button>
            <button className="btn ghost sm icon" disabled={source.n >= total} onClick={() => onShow(source.n + 1)} aria-label="Next source">
              <ArrowRight />
            </button>
            <a className="btn sm" href={source.url} target="_blank" rel="noopener noreferrer">
              Open the page <ExternalLink />
            </a>
            <button className="btn ghost sm icon" onClick={() => onShow(null)} aria-label="Close">
              <X />
            </button>
          </div>
        </figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shotUrl(source.run, source.shot)} alt={"The reader's screen on " + source.host} />
      </figure>
    </div>,
    document.body,
  );
}
