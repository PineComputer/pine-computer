"use client";

// The report on paper: one column, the sources spelled out with their addresses. The
// browser's own Print dialog saves it as a PDF.

import { useEffect, useState } from "react";
import { brand } from "@/brand";
import type { BriefView } from "@/shared/api";
import { call, enc } from "../common/api";
import { Cited } from "./Report";

export function PrintView({ id }: { id: string }) {
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    call<BriefView>("/api/briefs/" + enc(id))
      .then(setBrief)
      .catch(() => setProblem(true));
  }, [id]);

  // Opened from the report's PDF button: go straight to the Print dialog, once the type has loaded.
  useEffect(() => {
    if (!brief?.report || !new URLSearchParams(window.location.search).has("print")) return;
    void document.fonts.ready.then(() => window.print());
  }, [brief]);

  if (problem || (brief && !brief.report)) return <p className="print-none">This brief has no report to print.</p>;
  if (!brief?.report) return null;
  const { report } = brief;
  return (
    <article className="print">
      <p className="label">
        {brand.name} · {new Date(brief.createdAt).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}
      </p>
      <h1>{report.title || brief.question}</h1>
      <p className="asked">{brief.question}</p>
      <section className="answer">
        <Cited text={report.answer} />
      </section>
      {report.sections.map((section) => (
        <section key={section.angle} className="md">
          <h2>{section.title}</h2>
          <Cited text={section.body} />
        </section>
      ))}
      <section className="print-sources">
        <h2>Sources</h2>
        <p>Every source is a page a reader opened while it worked.</p>
        <ol>
          {report.sources.map((source) => (
            <li key={source.n}>
              <b>{source.title}</b>
              <span>{source.url}</span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
