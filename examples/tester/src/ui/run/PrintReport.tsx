"use client";

// The report on paper: the same findings, each with the screen kept as its evidence.
// Printing it (or "Save as PDF" in the print dialog) makes the file with the pictures.

import { Printer } from "lucide-react";
import { host, tally } from "@/shared/api";
import { useWorkspaceState } from "../app/Workspace";

export function PrintReport({ id }: { id: string }) {
  const { ws } = useWorkspaceState();
  if (!ws) return null;
  const run = ws.runs.find((r) => r.id === id);
  if (!run) return <p className="paper">That run isn&rsquo;t kept here.</p>;
  const count = tally(run.findings);
  const ordered = [...run.findings.filter((f) => f.status === "failed"), ...run.findings.filter((f) => f.status === "passed")];
  const decided = run.moments.filter((m) => m.kind === "approved" || m.kind === "declined");
  return (
    <article className="paper">
      <button className="btn primary print-btn" onClick={() => window.print()}>
        <Printer /> Print or save as PDF
      </button>
      <header>
        <p className="label">Test report · {new Date(run.askedAt).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}</p>
        <h1>{host(run.target)}</h1>
        <p className="sum" data-failed={count.failed > 0 || undefined}>
          {count.words}
        </p>
        <p className="asked">{run.checks}</p>
        {run.state !== "completed" ? <p className="note">The run did not finish ({run.state}). {run.summary}</p> : null}
        {decided.map((m) => (
          <p className="note" key={m.at}>
            A person {m.kind} the step the run stopped at.
          </p>
        ))}
      </header>
      {ordered.map((f) => (
        <section key={f.n} data-status={f.status}>
          <h2>
            <i className="verdict" data-status={f.status} />
            {f.n}. {f.title}
            <span>{f.status}</span>
          </h2>
          <dl>
            <dt>Expected</dt>
            <dd>{f.expected}</dd>
            <dt>Observed</dt>
            <dd>{f.observed}</dd>
            <dt>Where</dt>
            <dd>
              {f.url}
              {f.where ? ` · ${f.where}` : ""}
            </dd>
            {f.steps.length ? (
              <>
                <dt>Steps</dt>
                <dd>
                  <ol>
                    {f.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </dd>
              </>
            ) : null}
          </dl>
          {f.evidence ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/runs/${run.id}/screens/${f.evidence}`} alt={`The screen kept as evidence for check ${f.n}`} />
          ) : (
            <p className="note">No saved screen shows the page this finding names.</p>
          )}
        </section>
      ))}
    </article>
  );
}
