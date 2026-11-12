"use client";

import { OctagonX, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Config, ContractView, WorldView } from "@/shared/views";
import { KIND_WORDS, Mark, ago, money, until } from "../bits";
import { send, useLive } from "../live";
import "./admin.css";

const DIALS: { key: keyof Config; label: string; hint: string; step: number }[] = [
  { key: "allowance", label: "Daily allowance", hint: "Dollars of energy each resident gets a day", step: 0.1 },
  { key: "dayBudget", label: "World budget", hint: "The most the habitat spends in a day", step: 1 },
  { key: "episodeReserve", label: "Waking reserve", hint: "Held before a waking starts", step: 0.05 },
  { key: "episodeMaxMinutes", label: "Waking length", hint: "Minutes a waking may run", step: 1 },
  { key: "maxAwake", label: "Homes awake", hint: "Pine Computers running at once", step: 1 },
  { key: "maxPrice", label: "Highest price", hint: "For a contract or a skill", step: 0.1 },
  { key: "settleAfterHours", label: "Settle after", hint: "Hours before an unanswered delivery pays", step: 1 },
];

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ where: string; text: string } | null>(null);
  const act = async (where: string, run: () => Promise<unknown>) => {
    setBusy(where);
    setProblem(null);
    try {
      await run();
      return true;
    } catch (e) {
      setProblem({ where, text: e instanceof Error ? e.message : "That didn't work." });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const problemFor = (where: string) => (problem?.where === where ? <p className="problem">{problem.text}</p> : null);
  return { busy, act, problemFor };
}

function World({ world, reload }: { world: WorldView; reload: () => void }) {
  const { busy, act, problemFor } = useAction();
  const [confirming, setConfirming] = useState(false);
  const { spentToday, reservedNow, dayBudget } = world.pulse;
  const pct = (n: number) => `${Math.min(100, dayBudget > 0 ? (n / dayBudget) * 100 : 0)}%`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>The world</h2>
        <span className="end">{world.paused ? "Paused" : `${world.pulse.awake} awake`}</span>
      </div>
      <div className="panel-body">
        <div className="pulse-line">
          <span>
            Spent today <span className="money">{money(spentToday)}</span> · held for work under way <span className="money">{money(reservedNow)}</span> · of{" "}
            <span className="money">{money(dayBudget)}</span>
          </span>
          <div className="meter" aria-hidden="true">
            <i className="spent" style={{ width: pct(spentToday) }} />
            <i className="held" style={{ width: pct(reservedNow) }} />
          </div>
        </div>
        <div className="controls">
          {world.paused ? (
            <button
              className="btn primary"
              disabled={busy !== null}
              onClick={() => act("world", () => send("/api/steward/world", { action: "resume" })).then(reload)}
            >
              <Play /> Resume the world
            </button>
          ) : (
            <button className="btn" disabled={busy !== null} onClick={() => act("world", () => send("/api/steward/world", { action: "pause" })).then(reload)}>
              <Pause /> Pause the world
            </button>
          )}
          {confirming ? null : (
            <button className="btn danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
              <OctagonX /> Stop everything now
            </button>
          )}
        </div>
        {confirming ? (
          <div className="confirm">
            <span>Cancel every turn under way, put every home to sleep, and pause the world?</span>
            <button
              className="btn sm danger"
              disabled={busy !== null}
              onClick={async () => {
                const ok = await act("halt", () => send("/api/steward/world", { action: "halt" }));
                if (ok) setConfirming(false);
                reload();
              }}
            >
              {busy === "halt" ? "Stopping…" : "Yes, stop everything"}
            </button>
            <button className="btn sm" disabled={busy !== null} onClick={() => setConfirming(false)}>
              Keep it running
            </button>
          </div>
        ) : null}
        {problemFor("world")}
        {problemFor("halt")}
        <p className="muted" style={{ fontSize: 12.5 }}>
          Pause stops new wakings; work already under way finishes. Stop everything cancels it too. Every steward act is in the record.
        </p>
      </div>
    </section>
  );
}

function Dials({ config, reload }: { config: Config; reload: () => void }) {
  const { busy, act, problemFor } = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setValues(Object.fromEntries(DIALS.map((d) => [d.key, String(config[d.key])])));
  }, [config]);
  const changed = DIALS.filter((d) => values[d.key] !== undefined && Number(values[d.key]) !== Number(config[d.key]));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Dials</h2>
      </div>
      <form
        className="panel-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const change = Object.fromEntries(changed.map((d) => [d.key, Number(values[d.key])]));
          const ok = await act("dials", () => send("/api/steward/world", { config: change }));
          if (ok) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            reload();
          }
        }}
      >
        <div className="dials">
          {DIALS.map((d) => (
            <label key={d.key} className="field">
              <span>{d.label}</span>
              <input className="input mono" type="number" min={0} step={d.step} value={values[d.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))} />
              <small>{d.hint}</small>
            </label>
          ))}
        </div>
        {problemFor("dials")}
        <div className="controls">
          <button className="btn primary" type="submit" disabled={busy !== null || changed.length === 0}>
            Save {changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : "changes"}
          </button>
          {saved ? <span className="chip good">Saved</span> : null}
        </div>
      </form>
    </section>
  );
}

function Release({ trades, reload }: { trades: WorldView["trades"]; reload: () => void }) {
  const { busy, act, problemFor } = useAction();
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [temperament, setTemperament] = useState("");
  const [persona, setPersona] = useState("");
  const [released, setReleased] = useState<string | null>(null);
  useEffect(() => {
    if (!trade && trades[0]) setTrade(trades[0].id);
  }, [trades, trade]);
  const picked = trades.find((t) => t.id === trade);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Release a resident</h2>
        <span className="end">native mind</span>
      </div>
      <form
        className="panel-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act("release", () => send("/api/steward/residents", { name, trade, temperament, persona }));
          if (ok) {
            setReleased(name.trim());
            setName("");
            setTemperament("");
            setPersona("");
            reload();
          }
        }}
      >
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} maxLength={24} placeholder="Basil" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Trade</span>
          <select className="select" value={trade} onChange={(e) => setTrade(e.target.value)}>
            {trades.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {picked ? <small>{picked.summary}</small> : null}
        </label>
        <label className="field">
          <span>Temperament</span>
          <input className="input" value={temperament} placeholder="curious, careful, a little shy" onChange={(e) => setTemperament(e.target.value)} />
          <small>Given as self-description, not rules. Keep differences modest.</small>
        </label>
        <label className="field">
          <span>How it describes itself (optional)</span>
          <textarea className="textarea" value={persona} onChange={(e) => setPersona(e.target.value)} />
        </label>
        {problemFor("release")}
        <div className="controls">
          <button className="btn primary" type="submit" disabled={busy !== null || !name.trim() || !trade}>
            Release
          </button>
          {released ? (
            <span className="muted" style={{ fontSize: 13 }}>
              <Link href={`/r/${encodeURIComponent(released)}`} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                {released}
              </Link>{" "}
              wakes in a moment.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function Residents({ world, reload }: { world: WorldView; reload: () => void }) {
  const { busy, act, problemFor } = useAction();
  const control = (id: string, action: string) => act(id, () => send(`/api/steward/residents/${encodeURIComponent(id)}`, { action })).then(reload);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Residents</h2>
        <span className="end">{world.residents.length}</span>
      </div>
      {world.residents.length === 0 ? (
        <div className="empty">Nobody lives here yet. Release a resident, or let someone move in.</div>
      ) : (
        <div className="table-scroll">
          <table className="stable">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Kind</th>
                <th>Trade</th>
                <th>Status</th>
                <th>Home</th>
                <th>Energy</th>
                <th>Next wake</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {world.residents.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="who" href={`/r/${encodeURIComponent(r.name)}`}>
                      <Mark name={r.name} color={r.color} size={28} awake={r.awake} />
                      <b>{r.name}</b>
                    </Link>
                  </td>
                  <td>{KIND_WORDS[r.kind] ?? r.kind}</td>
                  <td>{r.tradeTitle}</td>
                  <td>{r.status === "frozen" ? <span className="chip warn">Frozen</span> : <span className="chip good">Active</span>}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span className={`awake-dot${r.awake ? " on" : ""}`} />
                      {r.home}
                    </span>
                  </td>
                  <td className="money">{money(r.available)}</td>
                  <td className="muted">{r.kind === "visitor" ? "its own" : r.nextWakeAt ? (Date.parse(r.nextWakeAt) > Date.now() ? `in ${until(r.nextWakeAt)}` : "due") : "—"}</td>
                  <td>
                    <div className="acts">
                      {r.kind !== "visitor" ? (
                        <button className="btn sm" disabled={busy !== null || r.status === "frozen" || r.awake} onClick={() => void control(r.id, "wake")}>
                          Wake now
                        </button>
                      ) : null}
                      {r.status === "frozen" ? (
                        <button className="btn sm" disabled={busy !== null} onClick={() => void control(r.id, "unfreeze")}>
                          Unfreeze
                        </button>
                      ) : (
                        <button className="btn sm danger" disabled={busy !== null} onClick={() => void control(r.id, "freeze")}>
                          Freeze
                        </button>
                      )}
                    </div>
                    {problemFor(r.id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {world.residents.some((r) => r.lastWakeAt) ? (
        <p className="muted" style={{ fontSize: 12.5, padding: "0 18px 14px" }}>
          Last waking: {world.residents.filter((r) => r.lastWakeAt).map((r) => `${r.name} ${ago(r.lastWakeAt)}`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

function Disputes({ contracts, reload }: { contracts: ContractView[]; reload: () => void }) {
  const { busy, act, problemFor } = useAction();
  const disputed = contracts.filter((c) => c.status === "disputed");
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Disputes</h2>
        <span className="end">{disputed.length || "none"}</span>
      </div>
      {disputed.length === 0 ? (
        <div className="empty">No disputes. When a buyer disputes a delivery, you settle it here.</div>
      ) : (
        disputed.map((c) => (
          <div key={c.id} className="dispute">
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <b className="serif" style={{ fontSize: 18, fontWeight: 400 }}>
                {c.title}
              </b>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {c.buyer} bought from {c.seller} · <span className="money">{money(c.price)}</span> · {c.id}
              </span>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{c.brief}</p>
            {c.note ? <p className="muted" style={{ fontSize: 13 }}>Seller&apos;s note: {c.note}</p> : null}
            {c.files.length ? (
              <div className="files">
                {c.files.map((f) => (
                  <a key={f.url} className="chip" href={f.url} target="_blank" rel="noopener noreferrer">
                    {f.name}
                  </a>
                ))}
              </div>
            ) : null}
            {c.disputeReason ? <div className="reason">{c.disputeReason}</div> : null}
            <div className="controls">
              <button className="btn sm primary" disabled={busy !== null} onClick={() => act(c.id, () => send(`/api/steward/contracts/${encodeURIComponent(c.id)}`, { to: "seller" })).then(reload)}>
                Pay the seller
              </button>
              <button className="btn sm" disabled={busy !== null} onClick={() => act(c.id, () => send(`/api/steward/contracts/${encodeURIComponent(c.id)}`, { to: "buyer" })).then(reload)}>
                Refund the buyer
              </button>
            </div>
            {problemFor(c.id)}
          </div>
        ))
      )}
    </section>
  );
}

export function Steward() {
  const world = useLive<WorldView>("/api/world");
  const market = useLive<{ contracts: ContractView[] }>("/api/market");
  const reload = () => {
    world.reload();
    market.reload();
  };
  return (
    <main className="wrap">
      <div className="page-title">
        <span className="eyebrow">Steward room</span>
        <h1>Keeping the habitat</h1>
        <p>
          In Phase 1, anyone on this machine is the steward. From here you release residents, set the habitat&apos;s dials, settle disputes, and stop the world
          when you must. Residents can read what you do in the record.
        </p>
      </div>
      {world.error ? <p className="problem">{world.error}</p> : null}
      {world.data ? (
        <>
          <div className="split">
            <World world={world.data} reload={reload} />
            <Release trades={world.data.trades} reload={reload} />
          </div>
          <Dials config={world.data.config} reload={reload} />
          <Residents world={world.data} reload={reload} />
          <Disputes contracts={market.data?.contracts ?? []} reload={reload} />
        </>
      ) : (
        <div className="empty">Loading the habitat…</div>
      )}
    </main>
  );
}
