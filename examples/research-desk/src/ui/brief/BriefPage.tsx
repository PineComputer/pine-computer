"use client";

// One brief, from the question to the report. What fills the page is whatever carries
// the proof at that stage: the angles to agree, then the wall of readers at work (or one
// of them opened large), then the report beside the screens of its sources.

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BriefView } from "@/shared/api";
import { call, enc } from "../common/api";
import { useDesk } from "../app/Desk";
import { Angles } from "./Angles";
import { Report } from "./Report";
import { useBriefStream } from "./useBriefStream";
import { Wall } from "./Wall";

const AT_WORK = new Set(["planning", "reading", "writing"]);

export function BriefPage({ id }: { id: string }) {
  const { version, act, desk } = useDesk();
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [missing, setMissing] = useState(false);
  /** The angle whose reader is opened large. */
  const [opened, setOpened] = useState<string | null>(null);
  const [tab, setTab] = useState<"readers" | "report" | null>(null);
  const [stopping, setStopping] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let current = true;
    call<BriefView>(`/api/briefs/${enc(id)}`)
      .then((view) => current && setBrief(view))
      .catch(() => current && setMissing(true));
    return () => {
      current = false;
    };
  }, [id, version]);

  const work = useBriefStream(id, Boolean(brief?.runs.some((run) => run.live)));

  if (missing) {
    return (
      <main className="brief">
        <div className="none">
          <h1>That brief isn&rsquo;t on this desk.</h1>
          <Link className="btn" href="/">
            Back to the desk
          </Link>
        </div>
      </main>
    );
  }
  if (!brief) return null;

  const showing = brief.state === "done" ? (tab ?? "report") : "readers";
  const reads = brief.runs.filter((run) => run.kind === "read");
  const writer = brief.runs.find((run) => run.kind === "write");
  const rewritable = brief.state === "failed" && reads.some((run) => run.state === "completed");

  return (
    <main className="brief" data-state={brief.state}>
      <header className="brief-head">
        <div>
          <p className="label">The question</p>
          <h1>{brief.question}</h1>
        </div>
        <div className="end">
          {brief.state === "done" ? (
            <div className="seg">
              <button aria-pressed={showing === "report"} onClick={() => (setTab("report"), setOpened(null))}>
                Report
              </button>
              <button aria-pressed={showing === "readers"} onClick={() => setTab("readers")}>
                Readers
              </button>
            </div>
          ) : null}
          {AT_WORK.has(brief.state) ? (
            <button
              className="btn sm"
              aria-busy={stopping}
              disabled={stopping}
              onClick={async () => {
                setStopping(true);
                await act(() => call(`/api/briefs/${enc(id)}`, { body: { action: "stop" } }));
                setStopping(false);
              }}
            >
              Stop
            </button>
          ) : null}
          {brief.state === "done" || brief.state === "failed" ? (
            <button
              className="btn ghost sm icon"
              title="Delete this brief"
              aria-label="Delete this brief"
              onClick={async () => {
                if (await act(() => call(`/api/briefs/${enc(id)}`, { method: "DELETE" }))) router.push("/");
              }}
            >
              <Trash2 />
            </button>
          ) : null}
        </div>
      </header>

      {brief.state === "planning" || brief.state === "draft" ? (
        <Angles brief={brief} readers={desk.readers} />
      ) : showing === "report" && brief.report ? (
        <Report brief={brief} report={brief.report} readers={desk.readers} />
      ) : (
        <>
          {brief.state === "writing" ? (
            <p className="stage-line" role="status">
              <i className="dot" data-status="working" />
              <b>The readers are done.</b> {desk.readers.find((r) => r.id === writer?.reader)?.name ?? "A reader"} is writing the report from their notes.
            </p>
          ) : brief.state === "failed" ? (
            <p className="stage-line" role="status">
              <i className="dot" data-status="bad" />
              <span>{brief.problem ?? "This brief stopped."}</span>
              {rewritable ? (
                <button className="btn sm" onClick={() => void act(() => call(`/api/briefs/${enc(id)}`, { body: { action: "rewrite" } }))}>
                  Write the report again
                </button>
              ) : (
                <Link className="btn sm" href="/">
                  Back to the desk
                </Link>
              )}
            </p>
          ) : null}
          <Wall brief={brief} work={work} readers={desk.readers} open={opened} onOpen={setOpened} />
        </>
      )}
    </main>
  );
}
