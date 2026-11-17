"use client";

// Before anything is read: the angles a reader proposed, for the person to change. One
// angle is one reader on one Computer.

import { ArrowRight, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Angle, BriefView, ReaderView } from "@/shared/api";
import { call, enc } from "../common/api";
import { useDesk } from "../app/Desk";

const COMPUTER: Record<ReaderView["computer"], string> = { none: "Its computer starts with the brief", stopped: "Its computer starts with the brief", starting: "Its computer is starting", running: "Its computer is ready", stopping: "Its computer is stopping" };

export function Angles({ brief, readers }: { brief: BriefView; readers: ReaderView[] }) {
  const { act } = useDesk();
  const planning = brief.state === "planning";
  const [angles, setAngles] = useState<Angle[]>(brief.angles);
  const [busy, setBusy] = useState(false);
  // The proposal arrives once; after that the angles are the person's.
  useEffect(() => setAngles(brief.angles.length ? brief.angles : [0, 1, 2].map((i) => ({ id: `a${i + 1}`, title: "", focus: "" }))), [brief.angles]);

  const planner = brief.runs.find((run) => run.kind === "plan");
  const change = (i: number, part: Partial<Angle>) => setAngles((all) => all.map((a, at) => (at === i ? { ...a, ...part } : a)));
  const ready = angles.filter((a) => a.title.trim()).length >= 2;

  if (planning) {
    const reader = readers.find((r) => r.id === planner?.reader);
    return (
      <section className="angles">
        <header>
          <h2>Splitting it into angles</h2>
          <p role="status">
            <i className="dot" data-status="working" />
            {planner?.state === "queued" ? planner.waiting : reader?.computer === "starting" || planner?.state === "starting" ? `${reader?.name ?? "A reader"} is starting its computer` : `${reader?.name ?? "A reader"} is proposing three angles`}
          </p>
        </header>
        <ol className="angle-list" aria-hidden>
          {readers.map((r, i) => (
            <li key={r.id} className="ghost-row">
              <span className="n">{i + 1}</span>
              <div>
                <b>{r.name}</b>
                <span>{COMPUTER[r.computer]}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="angles">
      <header>
        <h2>{angles.length === 2 ? "Two" : "Three"} angles, one reader each</h2>
        <p>{brief.problem ?? "Change the wording, or what each reader should look for. They all start at once."}</p>
      </header>
      <ol className="angle-list">
        {angles.map((angle, i) => (
          <li key={angle.id}>
            <span className="n">{i + 1}</span>
            <div>
              <input aria-label={`Angle ${i + 1}`} placeholder="An angle, in a few words" value={angle.title} maxLength={80} onChange={(event) => change(i, { title: event.target.value })} />
              <textarea aria-label={`What reader ${i + 1} should find out`} placeholder="What this reader should find out, and where to look" rows={2} value={angle.focus} maxLength={400} onChange={(event) => change(i, { focus: event.target.value })} />
            </div>
            <aside>
              <b>{readers[i]?.name}</b>
              <span>{readers[i] ? COMPUTER[readers[i].computer] : ""}</span>
              {angles.length > 2 ? (
                <button className="btn ghost sm icon" title="Remove this angle" aria-label={`Remove angle ${i + 1}`} onClick={() => setAngles((all) => all.filter((_, at) => at !== i))}>
                  <X />
                </button>
              ) : null}
            </aside>
          </li>
        ))}
      </ol>
      <footer>
        {angles.length < 3 ? (
          <button className="btn ghost" onClick={() => setAngles((all) => [...all, { id: `a${Date.now()}`, title: "", focus: "" }])}>
            <Plus /> Add an angle
          </button>
        ) : null}
        <button
          className="btn primary lg"
          disabled={!ready || busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            await act(() => call(`/api/briefs/${enc(brief.id)}`, { body: { action: "start", angles: angles.filter((a) => a.title.trim()) } }));
            setBusy(false);
          }}
        >
          Start {angles.filter((a) => a.title.trim()).length === 2 ? "two" : "three"} readers <ArrowRight />
        </button>
      </footer>
    </section>
  );
}
