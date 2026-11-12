"use client";

import { AlertCircle, CalendarClock, Clock3, Play, Plus, Repeat, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cadence, ScheduleView } from "@/shared/api";
import { describeCadence, next, validCadence } from "@/shared/cadence";
import { useApp } from "../app/AppProvider";
import { call, enc, errorText } from "../common/api";
import { relative } from "../common/format";
import { Confirm, Switch, useNow } from "../common/kit";
import "./schedules.css";

const EVERY = [
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 360, label: "6h" },
  { minutes: 720, label: "12h" },
  { minutes: 1440, label: "24h" },
];

export function SchedulesView() {
  const { app } = useApp();
  const [list, setList] = useState<ScheduleView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await call<ScheduleView[]>("/api/schedules"));
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    }
  }, []);

  // The server says when anything changed (a schedule fired, a run was recorded).
  useEffect(() => {
    void load();
  }, [app, load]);

  const empty = list !== null && list.length === 0;

  return (
    <div className="page">
      <div className="page-in">
        <header className="page-head">
          <div>
            <h1>Schedules</h1>
            <p>
              Tasks that run on their own. This app&apos;s server fires them even with no page open, and starts the Computer if it&apos;s stopped. Each slot
              runs once, whatever retries happen along the way.
            </p>
          </div>
          {!empty ? (
            <div className="end">
              <button className="btn primary" onClick={() => setComposing((open) => !open)} disabled={!app?.computer}>
                <Plus /> New schedule
              </button>
            </div>
          ) : null}
        </header>

        {problem ? <p className="problem">{problem}</p> : null}

        {!app?.computer ? (
          <div className="card sched-empty">
            <div className="sched-empty-mark">
              <CalendarClock />
            </div>
            <h2>Create a Computer first</h2>
            <p>Schedules run on your Computer, starting it when they&apos;re due.</p>
            <Link className="btn primary" href="/">
              Create a Computer
            </Link>
          </div>
        ) : empty || composing ? (
          <Composer
            first={empty}
            onCreated={async () => {
              setComposing(false);
              await load();
            }}
            onCancel={empty ? undefined : () => setComposing(false)}
          />
        ) : null}

        {list === null && !problem ? (
          <div className="sched-list">
            <div className="card sched-skeleton" />
            <div className="card sched-skeleton" />
          </div>
        ) : list?.length ? (
          <div className="sched-list">
            {list.map((schedule) => (
              <ScheduleCard key={schedule.id} schedule={schedule} onChanged={load} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Composer({ first, onCreated, onCancel }: { first: boolean; onCreated: () => Promise<void>; onCancel?: () => void }) {
  const { app, toast } = useApp();
  const sessions = useMemo(() => app?.sessions ?? [], [app?.sessions]);
  const [label, setLabel] = useState("");
  const [goal, setGoal] = useState("");
  const [session, setSession] = useState(sessions[0]?.name ?? "main");
  const [cadence, setCadence] = useState<Cadence>({ kind: "daily", at: "09:00", weekdays: true });
  const [saving, setSaving] = useState(false);
  const now = useNow(30_000);

  useEffect(() => {
    if (!sessions.some((s) => s.name === session) && sessions[0]) setSession(sessions[0].name);
  }, [sessions, session]);

  const valid = validCadence(cadence);
  const create = async () => {
    setSaving(true);
    try {
      const created = await call<ScheduleView>("/api/schedules", { body: { label, goal, session, cadence } });
      toast({ tone: "done", text: `“${created.label}” runs ${relative(Date.parse(created.nextAt))}` });
      setLabel("");
      setGoal("");
      await onCreated();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`card sched-compose${first ? " first" : ""}`}>
      <header className="card-head">
        <Repeat size={15} style={{ color: "var(--accent-text)" }} />
        <h2>{first ? "Schedule your first task" : "New schedule"}</h2>
      </header>
      <div className="card-body">
        <div className="sched-form">
          <label className="field">
            <span>Name</span>
            <input className="input" placeholder="Morning briefing" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} />
          </label>
          <label className="field">
            <span>Runs in</span>
            <select className="select" value={session} onChange={(event) => setSession(event.target.value)}>
              {sessions.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Task</span>
          <textarea
            className="textarea"
            placeholder="Read today's top stories on Hacker News and the pages they link to, and save a one-page brief on the three that matter most to a software team."
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          <small>It runs as written, with your vault, in the session you choose. Refer to a secret as $NAME.</small>
        </label>

        <div className="field">
          <span>How often</span>
          <CadenceEditor cadence={cadence} onChange={setCadence} />
        </div>

        <div className="sched-compose-bar">
          <span className="sched-preview">
            <Clock3 size={14} />
            {valid ? (
              <>
                {describeCadence(cadence)} · first run <b>{relative(next(cadence, new Date(now)).getTime(), now)}</b>
              </>
            ) : (
              "Every 15 minutes or more, or a time of day"
            )}
          </span>
          {onCancel ? (
            <button className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button className="btn primary" aria-busy={saving} disabled={saving || !goal.trim() || !valid} onClick={() => void create()}>
            Schedule it
          </button>
        </div>
      </div>
    </section>
  );
}

function CadenceEditor({ cadence, onChange }: { cadence: Cadence; onChange: (cadence: Cadence) => void }) {
  return (
    <div className="cadence">
      <div className="seg" role="tablist" aria-label="Kind of schedule">
        <button
          role="tab"
          aria-selected={cadence.kind === "daily"}
          onClick={() => cadence.kind !== "daily" && onChange({ kind: "daily", at: "09:00", weekdays: false })}
        >
          Daily at a time
        </button>
        <button role="tab" aria-selected={cadence.kind === "interval"} onClick={() => cadence.kind !== "interval" && onChange({ kind: "interval", minutes: 60 })}>
          Every so often
        </button>
      </div>
      {cadence.kind === "interval" ? (
        <div className="seg pills" role="radiogroup" aria-label="Every">
          {EVERY.map((option) => (
            <button key={option.minutes} role="radio" aria-checked={cadence.minutes === option.minutes} onClick={() => onChange({ kind: "interval", minutes: option.minutes })}>
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="cadence-daily">
          <input className="input mono" type="time" value={cadence.at} onChange={(event) => onChange({ ...cadence, at: event.target.value })} aria-label="Time of day" />
          <label className="cadence-weekdays">
            <Switch label="Weekdays only" checked={cadence.weekdays} onChange={(weekdays) => onChange({ ...cadence, weekdays })} />
            Weekdays only
          </label>
        </div>
      )}
    </div>
  );
}

function ScheduleCard({ schedule, onChanged }: { schedule: ScheduleView; onChanged: () => Promise<void> }) {
  const { app, toast } = useApp();
  const now = useNow(15_000);
  const [running, setRunning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const session = app?.sessions.find((s) => s.name === schedule.session);
  const url = `/api/schedules/${enc(schedule.id)}`;

  const toggle = async (enabled: boolean) => {
    setSwitching(true);
    try {
      await call(url, { method: "PATCH", body: { enabled } });
      await onChanged();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setSwitching(false);
    }
  };

  // The server says how it went (started, or why not) as a notice of its own.
  const runNow = async () => {
    setRunning(true);
    try {
      await call(url, { method: "POST" });
    } catch {
      // already told, by the server's notice
    } finally {
      setRunning(false);
      await onChanged();
    }
  };

  return (
    <article className="card sched-card" data-off={!schedule.enabled || undefined}>
      <div className="sched-main">
        <Switch label={schedule.enabled ? `Turn off ${schedule.label}` : `Turn on ${schedule.label}`} checked={schedule.enabled} disabled={switching} onChange={(on) => void toggle(on)} />
        <div className="sched-text">
          <h3>{schedule.label}</h3>
          <p className="sched-goal">{schedule.goal}</p>
          <div className="sched-meta">
            <span className="badge">
              <Repeat size={11} /> {describeCadence(schedule.cadence)}
            </span>
            <span className="badge">in {session?.label ?? schedule.session}</span>
          </div>
        </div>
        <div className="sched-acts">
          <button className="btn sm" aria-busy={running} disabled={running} onClick={() => void runNow()} title="Runs it now, starting the Computer if it must">
            <Play /> Run now
          </button>
          <button className="btn ghost icon sm danger" aria-label={`Delete ${schedule.label}`} onClick={() => setConfirm(true)}>
            <Trash2 />
          </button>
        </div>
      </div>
      <footer className="sched-foot">
        <span>
          <span className="muted">Next</span>{" "}
          {schedule.enabled ? <b>{relative(Date.parse(schedule.nextAt), now)}</b> : <span className="muted">off</span>}
        </span>
        {schedule.lastError ? (
          <span className="sched-error" title={schedule.lastError}>
            <AlertCircle size={13} /> {schedule.lastError}
          </span>
        ) : schedule.lastAt ? (
          <span>
            <span className="muted">Last ran</span> {relative(Date.parse(schedule.lastAt), now)}
            {schedule.lastTurnId && session ? (
              <>
                {" · "}
                <Link className="sched-link" href={`/s/${enc(schedule.session)}`}>
                  See it
                </Link>
              </>
            ) : null}
          </span>
        ) : (
          <span className="muted">Hasn&apos;t run yet</span>
        )}
      </footer>
      {confirm ? (
        <Confirm
          title={`Delete “${schedule.label}”?`}
          body="It won't run again. Runs it already started, and what they returned, stay in their session."
          action="Delete"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await call(url, { method: "DELETE" });
              await onChanged();
            } catch (error) {
              toast({ tone: "failed", text: errorText(error) });
            }
          }}
        />
      ) : null}
    </article>
  );
}
