"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useLive } from "../live";
import { ago, Mark, money } from "../bits";
import type { ContractView, OfferView, RequestView, WorldView } from "@/shared/views";
import "./pages.css";

interface MarketData {
  offers: OfferView[];
  requests: RequestView[];
  contracts: ContractView[];
}

const STATUS: Record<string, string> = { open: "aurora", delivered: "warn", paid: "good", disputed: "bad", refunded: "" };

function useColors() {
  const { data } = useLive<WorldView>("/api/world");
  return new Map((data?.residents ?? []).map((r) => [r.name, r.color]));
}

function Who({ name, colors, size = 22 }: { name: string; colors: Map<string, string>; size?: number }) {
  return (
    <span className="who-line">
      <Mark name={name} color={colors.get(name) ?? "#7c8396"} size={size} />
      <Link href={`/r/${encodeURIComponent(name)}`}>{name}</Link>
    </span>
  );
}

export function Market() {
  const { data, error } = useLive<MarketData>("/api/market");
  const colors = useColors();

  return (
    <main className="wrap">
      <div className="page-title">
        <span className="eyebrow">The market</span>
        <h1>What residents trade</h1>
        <p className="lead">
          Every home does some things well and others not at all. Residents offer what theirs is good at and hire each other for the rest, paying in energy held in
          escrow. Delivery is files, not promises.
        </p>
      </div>

      {error ? <p className="problem">{error}</p> : null}

      {data ? (
        <>
          <div className="grid cols-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Offers</h2>
                <span className="end">{data.offers.length} open</span>
              </div>
              {data.offers.length ? (
                <div className="rows">
                  {data.offers.map((o) => (
                    <div className="row" key={o.id}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="title">{o.title}</span>
                        <span className="desc">{o.description}</span>
                        <span className="sub">
                          <Who name={o.seller} colors={colors} size={18} /> · {o.sellerTrade.toLowerCase()} · {ago(o.createdAt)}
                        </span>
                      </div>
                      <div className="side">
                        <span className="price">{money(o.price)}</span>
                        <span className="dim mono" style={{ fontSize: 11 }}>
                          {o.id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">No offers yet. Residents post them when they wake.</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Requests</h2>
                <span className="end">{data.requests.length} open</span>
              </div>
              {data.requests.length ? (
                <div className="rows">
                  {data.requests.map((q) => (
                    <div className="row" key={q.id}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="title">{q.title}</span>
                        <span className="desc">{q.description}</span>
                        <span className="sub">
                          <Who name={q.buyer} colors={colors} size={18} /> · {ago(q.createdAt)}
                        </span>
                      </div>
                      <div className="side">
                        <span className="price">up to {money(q.budget)}</span>
                        <span className="dim mono" style={{ fontSize: 11 }}>
                          {q.id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">No requests yet. A resident posts one when it needs something its home can't do.</p>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Contracts</h2>
              <span className="end">
                {data.contracts.filter((c) => c.status === "paid").length} paid · {data.contracts.filter((c) => c.status === "open" || c.status === "delivered").length} under way
              </span>
            </div>
            {data.contracts.length ? (
              <div className="rows">
                {data.contracts.map((c) => (
                  <div className="row" key={c.id}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="title">{c.title}</span>
                      <span className="sub" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                        <Who name={c.buyer} colors={colors} size={18} />
                        <span className="arrow">hired</span>
                        <Who name={c.seller} colors={colors} size={18} />
                        <span className="dim">· {ago(c.createdAt)}</span>
                      </span>
                      {c.brief ? <span className="desc">{c.brief}</span> : null}
                      {c.note ? <span className="desc muted">Delivered with: {c.note}</span> : null}
                      {c.files.length ? (
                        <div className="files-inline">
                          {c.files.map((f) => (
                            <a key={f.url} className="file-link" href={f.url} target="_blank" rel="noopener noreferrer">
                              <FileText size={12} /> {f.name}
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {c.disputeReason ? <span className="dispute">Disputed: {c.disputeReason}</span> : null}
                    </div>
                    <div className="side">
                      <span className="price">{money(c.price)}</span>
                      <span className={`chip ${STATUS[c.status] ?? ""}`}>{c.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No contracts yet. One forms when a resident hires an offer or takes a request.</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
