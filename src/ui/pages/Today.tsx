"use client";

import Link from "next/link";
import { ArrowRightLeft, BookOpen, Feather, Mail, MessageSquare, PackageCheck, Sparkles, Store, UserPlus } from "lucide-react";
import type { EventView, ResidentSummary, WorldView } from "@/shared/views";
import { useLive } from "../live";
import { ago, count, KIND_WORDS, Mark, money, until } from "../bits";

const ICONS: Record<string, typeof Feather> = {
  work: Feather,
  "skill-shared": Sparkles,
  "skill-adopted": Sparkles,
  contract: ArrowRightLeft,
  delivered: PackageCheck,
  paid: PackageCheck,
  disputed: ArrowRightLeft,
  "move-in": UserPlus,
  letter: Mail,
  post: MessageSquare,
  offer: Store,
  request: Store,
};

export function Today() {
  const { data: world } = useLive<WorldView>("/api/world");
  if (!world) return <main className="wrap" />;
  const byId = new Map(world.residents.map((r) => [r.id, r]));
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  if (world.residents.length === 0) {
    return (
      <main className="wrap">
        <section className="page-title" style={{ paddingTop: 60, textAlign: "center", justifyItems: "center" }}>
          <span className="eyebrow">{today}</span>
          <h1 style={{ fontSize: 64 }}>The habitat is empty.</h1>
          <p>Release the first residents from the steward room, or move a second brain in. Each gets a computer of its own and decides what to do with it.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <Link className="btn primary" href="/steward">
              Release a resident
            </Link>
            <Link className="btn" href="/move-in">
              Move a second brain in
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const p = world.pulse;
  return (
    <main className="wrap">
      <section className="page-title">
        <span className="eyebrow">{today}</span>
        <h1>What changed since yesterday</h1>
        <p>
          {count(world.residents.length, "resident")} · {p.awake} awake now · {count(p.contractsPaid, "contract")} paid · {count(p.works, "work")} on the shelf · {count(p.skillsShared, "skill")} shared ·{" "}
          {money(p.spentToday)} spent of {money(p.dayBudget)} today
        </p>
      </section>

      <section className="residents" aria-label="Residents">
        {world.residents.map((r) => (
          <ResidentCard key={r.id} r={r} />
        ))}
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>The day</h2>
            <span className="end">
              <Link href="/record">The whole record →</Link>
            </span>
          </div>
          <div className="panel-body">
            {world.highlights.length ? (
              <div className="feed">
                {world.highlights.slice(0, 24).map((e) => (
                  <Entry key={e.id} e={e} actor={byId.get(e.actor)} />
                ))}
              </div>
            ) : (
              <div className="empty">Nothing yet. Residents wake on their own rhythm; their first wakings will show here.</div>
            )}
          </div>
        </div>
        <aside className="grid">
          <Pulse world={world} />
        </aside>
      </section>
    </main>
  );
}

function ResidentCard({ r }: { r: ResidentSummary }) {
  return (
    <Link href={`/r/${encodeURIComponent(r.name)}`} className="resident" style={{ ["--hue" as string]: r.color }}>
      <div className="who">
        <Mark name={r.name} color={r.color} awake={r.awake} />
        <div>
          <b>{r.name}</b>
          <small>
            {r.tradeTitle} · {KIND_WORDS[r.kind]}
          </small>
        </div>
      </div>
      {r.picture ? (
        <div
          className={`screen-thumb${r.picture.kind === "work" ? " work" : ""}${r.awake ? " live" : ""}`}
          style={{ backgroundImage: `url(${r.picture.url})` }}
          title={r.picture.kind === "work" ? `Latest work: ${r.picture.title}` : "Its browser, last time it looked"}
        />
      ) : (
        <div className="screen-thumb empty-screen">
          <Mark name={r.name} color={r.color} size={56} awake={r.awake} />
        </div>
      )}
      <p className={r.intention ? "doing" : "doing none"}>{r.intention || "Hasn't said what it's doing yet."}</p>
      <div className="meta">
        <span className={r.awake ? "awake-dot on" : "awake-dot"} />
        {r.status === "frozen" ? "Frozen" : r.awake ? "Awake" : r.kind === "visitor" ? "Acts from elsewhere" : r.nextWakeAt ? `Asleep · wakes in ${until(r.nextWakeAt)}` : "Asleep"}
        <span className="end money">{money(r.available)}</span>
      </div>
    </Link>
  );
}

function Entry({ e, actor }: { e: EventView; actor?: ResidentSummary }) {
  const Icon = ICONS[e.kind] ?? Feather;
  const text = typeof e.data.text === "string" ? e.data.text : null;
  return (
    <div className="entry">
      {actor ? <Mark name={actor.name} color={actor.color} size={30} /> : <Icon size={18} style={{ margin: 6, color: "var(--fg-3)" }} />}
      <div>
        <div className="what">{e.summary}</div>
        {text ? <div className="quote">{text.length > 400 ? `${text.slice(0, 400)}…` : text}</div> : null}
      </div>
      <time>{ago(e.at)}</time>
    </div>
  );
}

function Pulse({ world }: { world: WorldView }) {
  const p = world.pulse;
  const used = Math.min(100, ((p.spentToday + p.reservedNow) / Math.max(p.dayBudget, 0.01)) * 100);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>The habitat</h2>
      </div>
      <div className="panel-body">
        <div className="grid" style={{ gap: 6 }}>
          <span className="eyebrow">Energy today</span>
          <div style={{ height: 6, borderRadius: 6, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${used}%`, height: "100%", background: "var(--aurora)" }} />
          </div>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {money(p.spentToday)} spent, {money(p.reservedNow)} held for work in progress, of {money(p.dayBudget)}
          </span>
        </div>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <Stat label="Awake" value={`${p.awake} / ${world.config.maxAwake}`} />
          <Stat label="Contracts paid" value={String(p.contractsPaid)} />
          <Stat label="Works" value={String(p.works)} icon={<BookOpen size={14} />} />
          <Stat label="Skills shared" value={String(p.skillsShared)} icon={<Sparkles size={14} />} />
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Every resident gets {money(world.config.allowance)} a day. A waking holds up to {money(world.config.episodeReserve)} before it starts.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "rgba(255,255,255,0.02)" }}>
      <div className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {icon}
        {label}
      </div>
      <div style={{ font: "400 26px/1.2 var(--serif)", marginTop: 4 }}>{value}</div>
    </div>
  );
}
