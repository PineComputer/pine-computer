"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { useState } from "react";
import type { EpisodeView, ResidentDetail } from "@/shared/views";
import { useLive } from "../live";
import { ago, clock, KIND_WORDS, Mark, Markdown, money, until } from "../bits";

export function ResidentPage({ name }: { name: string }) {
  const { data: r, error } = useLive<ResidentDetail>(`/api/residents/${encodeURIComponent(name)}`);
  if (error) return <main className="wrap"><p className="problem">{error}</p></main>;
  if (!r) return <main className="wrap" />;
  const latest = r.episodes.find((e) => e.frame);
  const journals = r.episodes.filter((e) => e.journal.trim());

  return (
    <main className="wrap">
      <section style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 22, alignItems: "center" }}>
        <Mark name={r.name} color={r.color} size={84} awake={r.awake} />
        <div className="page-title">
          <span className="eyebrow">
            {KIND_WORDS[r.kind]} · {r.tradeTitle} · moved in {ago(r.createdAt)}
          </span>
          <h1 style={{ fontSize: 56 }}>{r.name}</h1>
          {r.persona ? <p>{r.persona}</p> : null}
          {r.temperament ? <p className="dim">Temperament: {r.temperament}</p> : null}
        </div>
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <span className="chip" style={{ borderColor: r.color, color: r.color }}>
            <span className={r.awake ? "awake-dot on" : "awake-dot"} /> {r.status === "frozen" ? "Frozen" : r.awake ? "Awake" : "Asleep"}
          </span>
          <span className="money">{money(r.available)} available</span>
          {r.nextWakeAt && !r.awake && r.kind !== "visitor" ? <span className="dim" style={{ fontSize: 12 }}>wakes in {until(r.nextWakeAt)}</span> : null}
        </div>
      </section>

      <section className="split">
        <div className="grid" style={{ gap: 22 }}>
          <div className="panel" style={{ ["--hue" as string]: r.color }}>
            <div className="panel-head">
              <h2>Now</h2>
              <span className="end">{r.tradeSummary}</span>
            </div>
            <div className="panel-body">
              <p style={{ font: "400 22px/1.35 var(--serif)" }}>{r.intention || <span className="dim">It hasn't said what it is doing yet.</span>}</p>
              {latest?.frame ? (
                <div className={`screen-thumb${r.awake ? " live" : ""}`} style={{ backgroundImage: `url(${latest.frame})`, aspectRatio: "16 / 9" }} />
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Working note</h2>
              <span className="end">as it last wrote it, in its home&apos;s note.md</span>
            </div>
            <div className="panel-body">{r.note.trim() ? <Markdown text={r.note} /> : <div className="empty">No note yet.</div>}</div>
          </div>

          {journals.length ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Journal</h2>
              </div>
              <div className="panel-body">
                {journals.slice(0, 5).map((e) => (
                  <div key={e.id} style={{ display: "grid", gap: 6, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
                    <span className="eyebrow">{clock(e.startedAt)}</span>
                    <Markdown text={e.journal} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <h2>Wakings</h2>
              <span className="end">each with what the habitat did, and what it cost</span>
            </div>
            <div className="panel-body">
              {r.episodes.length ? r.episodes.map((e) => <Waking key={e.id} e={e} />) : <div className="empty">It hasn&apos;t woken yet.</div>}
            </div>
          </div>
        </div>

        <aside className="grid" style={{ gap: 22 }}>
          <div className="panel">
            <div className="panel-head">
              <h2>Made</h2>
              <span className="end">
                <Link href="/shelf">the shelf →</Link>
              </span>
            </div>
            <div className="panel-body">
              {r.works.length ? (
                r.works.map((w) => (
                  <div key={w.id}>
                    <div style={{ fontWeight: 500 }}>{w.title}</div>
                    <div className="dim" style={{ fontSize: 12.5 }}>
                      {w.files.map((f) => f.name).join(", ")} · {ago(w.at)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="dim">Nothing published yet.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Skills</h2>
              <span className="end">
                <Link href="/library">the library →</Link>
              </span>
            </div>
            <div className="panel-body">
              {[...r.skillsShared.map((k) => ({ k, how: "shared" })), ...r.skillsAdopted.map((k) => ({ k, how: `adopted from ${k.author}` }))].map(({ k, how }) => (
                <div key={`${k.id}-${how}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span className="mono">{k.name}</span>
                  <span className="dim" style={{ fontSize: 12.5 }}>{how}</span>
                </div>
              ))}
              {!r.skillsShared.length && !r.skillsAdopted.length ? <div className="dim">Only its trade&apos;s skill, so far.</div> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Contracts</h2>
              <span className="end">
                <Link href="/market">the market →</Link>
              </span>
            </div>
            <div className="panel-body">
              {r.contracts.length ? (
                r.contracts.slice(0, 10).map((c) => (
                  <div key={c.id} style={{ display: "grid", gap: 2 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 500 }}>{c.title}</span>
                      <span className={`chip ${c.status === "paid" ? "good" : c.status === "delivered" ? "warn" : c.status === "disputed" ? "bad" : "aurora"}`}>{c.status}</span>
                    </div>
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      {c.buyer} → {c.seller} · {money(c.price)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="dim">No trades yet.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Energy</h2>
              <span className="end money">{money(r.balance)}</span>
            </div>
            <div className="panel-body" style={{ gap: 6 }}>
              {r.ledger.slice(0, 14).map((l) => (
                <div key={l.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, fontSize: 12.5 }}>
                  <span className="muted">{l.memo || l.kind}</span>
                  <span className="money" style={{ color: l.amount < 0 ? "var(--fg-2)" : "var(--good)" }}>
                    {l.amount > 0 ? "+" : ""}
                    {money(l.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Waking({ e }: { e: EpisodeView }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="eyebrow">{clock(e.startedAt)}</span>
          <span className={`chip ${e.state === "done" ? "" : e.state === "running" ? "aurora" : "bad"}`}>{e.kind === "job" ? `job · ${e.state}` : e.state}</span>
          <span className="money dim">{e.cost === null ? "" : money(e.cost)}</span>
        </div>
        <div style={{ fontWeight: 500 }}>{e.intention || e.goal || (e.state === "running" ? "Awake now…" : <span className="dim">No intention written.</span>)}</div>
        {e.results.length ? (
          <ul style={{ listStyle: "none", display: "grid", gap: 3, fontSize: 13 }}>
            {e.results.map((x, i) => (
              <li key={i} style={{ display: "flex", gap: 6, color: x.ok ? "var(--fg-2)" : "var(--bad)" }}>
                {x.ok ? <Check size={14} style={{ color: "var(--good)", flex: "none", marginTop: 3 }} /> : <X size={14} style={{ flex: "none", marginTop: 3 }} />}
                {x.detail}
              </li>
            ))}
          </ul>
        ) : null}
        {e.error ? <div className="problem">{e.error}</div> : null}
        {e.summary ? (
          <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "What its computer said"}
          </button>
        ) : null}
        {open ? <Markdown text={e.summary} /> : null}
      </div>
      {e.frame ? <div className="screen-thumb" style={{ width: 150, backgroundImage: `url(${e.frame})` }} /> : null}
    </div>
  );
}
