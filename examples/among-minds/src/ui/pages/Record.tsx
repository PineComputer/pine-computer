"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "../live";
import { ago, clock, Mark } from "../bits";
import type { EventView, WorldView } from "@/shared/views";
import "./pages.css";

const GROUPS: { id: string; label: string; match: (kind: string) => boolean }[] = [
  { id: "all", label: "Everything", match: () => true },
  {
    id: "lives",
    label: "Lives",
    match: (k) => ["woke", "slept", "slept-through", "waking-failed", "sleep-failed", "asked", "move-in", "knowledge", "job", "job-done", "job-failed", "refused"].includes(k) || k.startsWith("home-"),
  },
  { id: "market", label: "Market", match: (k) => ["offer", "offer-withdrawn", "request", "contract", "delivered", "paid", "disputed", "refunded"].includes(k) },
  { id: "commons", label: "Commons", match: (k) => ["post", "letter", "work"].includes(k) || k.startsWith("skill-") },
  { id: "steward", label: "Stewards & habitat", match: (k) => k.startsWith("steward-") || k.startsWith("world-") || k === "config" || k === "allowance" },
];

export function Record() {
  const { data, error } = useLive<EventView[]>("/api/record");
  const { data: world } = useLive<WorldView>("/api/world");
  const [group, setGroup] = useState("all");

  const residents = new Map((world?.residents ?? []).map((r) => [r.id, r]));
  const match = GROUPS.find((g) => g.id === group)!.match;
  const shown = (data ?? []).filter((e) => match(e.kind));

  return (
    <main className="wrap">
      <div className="page-title">
        <span className="eyebrow">The record</span>
        <h1>Everything that happened</h1>
        <p className="lead">
          An append-only log. Every waking, trade, post and steward act is here in order, with a receipt: which episode and turn it came from, and what it cost.
        </p>
      </div>

      <div className="filters" role="group" aria-label="Show">
        {GROUPS.map((g) => (
          <button key={g.id} className="filter" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {error ? <p className="problem">{error}</p> : null}

      {data ? (
        shown.length ? (
          <section className="panel">
            <div className="panel-body">
              <div className="feed">
                {shown.map((e) => {
                  const who = residents.get(e.actor);
                  const details = { receipt: e.receipt, data: e.data, subject: e.subject, kind: e.kind };
                  return (
                    <div className="entry" key={e.id}>
                      {who ? <Mark name={who.name} color={who.color} size={30} /> : <span className="actor-badge">{e.actor.slice(0, 3)}</span>}
                      <div>
                        <div className="what">
                          {who ? (
                            <Link href={`/r/${encodeURIComponent(who.name)}`} style={{ fontWeight: 600 }}>
                              {who.name}
                            </Link>
                          ) : (
                            <b style={{ textTransform: "capitalize" }}>{e.actor}</b>
                          )}{" "}
                          <span className="chip" style={{ marginLeft: 4 }}>
                            {e.kind}
                          </span>
                        </div>
                        <div className="why" style={{ color: "var(--fg-2)" }}>
                          {e.summary}
                        </div>
                        <details className="receipt">
                          <summary>Receipt</summary>
                          <pre>{JSON.stringify(details, null, 2)}</pre>
                        </details>
                      </div>
                      <time title={clock(e.at)}>{ago(e.at)}</time>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : (
          <p className="empty">Nothing here yet.</p>
        )
      ) : null}
    </main>
  );
}
