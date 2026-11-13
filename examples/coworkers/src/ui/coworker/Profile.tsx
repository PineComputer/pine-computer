"use client";

import { Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CoworkerView } from "@/shared/api";
import { call, enc } from "../common/api";
import { ago, clock, cost, duration } from "../common/format";
import { Avatar, Confirm } from "../common/kit";
import { useWorkspace } from "../app/Workspace";

const MACHINE_WORDS = { none: "Not created yet", stopped: "Stopped", starting: "Starting", running: "Running", stopping: "Stopping" };

/** Who a coworker is and what it has: its brief, its own Computer, its skills, its recent work and what each job cost. */
export function Profile({ coworker }: { coworker: CoworkerView }) {
  const { ws, act } = useWorkspace();
  const router = useRouter();
  const [editing, setEditing] = useState<{ role: string; brief: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const url = `/api/coworkers/${enc(coworker.id)}`;

  const jobs = ws.jobs.filter((j) => j.coworker === coworker.id);
  const recent = jobs.filter((j) => j.kind === "run").slice(-8).reverse();
  // A reply carries its job on: its time and cost count toward the thread's work.
  const spent = jobs.reduce((sum, j) => sum + (j.cost ?? 0), 0);
  const state = coworker.computer;
  const lifecycle = async (action: "start" | "stop") => {
    setBusy(true);
    await act(() => call(url, { body: { action } }));
    setBusy(false);
  };

  return (
    <div className="profile">
      <div className="profile-head">
        <Avatar name={coworker.name} color={coworker.color} status={coworker.status} size="lg" />
        <div>
          <h2>{coworker.name}</h2>
          <p>{coworker.role}</p>
        </div>
      </div>

      <section>
        <header>
          <span className="label">Brief</span>
          <span className="end">
            {editing ? null : (
              <button className="btn ghost sm" onClick={() => setEditing({ role: coworker.role, brief: coworker.brief })}>
                Edit
              </button>
            )}
          </span>
        </header>
        {editing ? (
          <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (await act(() => call(url, { method: "PATCH", body: editing }))) setEditing(null);
            }}
          >
            <input className="input" value={editing.role} maxLength={40} aria-label="Role" onChange={(event) => setEditing({ ...editing, role: event.target.value })} />
            <textarea className="textarea" value={editing.brief} maxLength={600} aria-label="Brief" onChange={(event) => setEditing({ ...editing, brief: event.target.value })} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary sm">Save</button>
              <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className="brief">{coworker.brief}</p>
        )}
      </section>

      <section>
        <header>
          <span className="label">Its computer</span>
          <span className="end">
            {state === "running" || state === "stopping" ? (
              <button className="btn sm" aria-busy={busy || state === "stopping"} disabled={busy || state === "stopping"} onClick={() => void lifecycle("stop")}>
                <Square /> Stop
              </button>
            ) : (
              <button className="btn sm" aria-busy={busy || state === "starting"} disabled={busy || state === "starting"} onClick={() => void lifecycle("start")}>
                <Play /> {state === "none" ? "Create" : "Start"}
              </button>
            )}
          </span>
        </header>
        <p className="machine">
          <i className="dot" data-status={state === "running" ? "ok" : state === "starting" || state === "stopping" ? "working" : "idle"} />
          {MACHINE_WORDS[state]}
          <span className="muted">
            {state === "running"
              ? coworker.expiresAt
                ? `Stops itself at ${clock(Date.parse(coworker.expiresAt))} if nothing uses it`
                : "Stops itself when idle"
              : state === "none"
                ? "Its first job creates it"
                : state === "stopped"
                  ? "Its sign-ins and skills are saved. The next job starts it"
                  : ""}
          </span>
        </p>
      </section>

      <section>
        <header>
          <span className="label">Skills</span>
        </header>
        {coworker.skills.length ? (
          <ul className="table">
            {coworker.skills.map((skill) => (
              <li key={skill.name} className="skill">
                <span className="mono">{skill.name}</span>
                <span className="d">{skill.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">None yet. After a job goes well, choose Save as a skill under its answer.</p>
        )}
      </section>

      <section>
        <header>
          <span className="label">Recent work</span>
        </header>
        {recent.length ? (
          <ul className="table">
            {recent.map((job) => (
              <li key={job.id}>
                <Link className="t" href={`/t/${job.thread}`} title={job.ask}>
                  {job.ask}
                </Link>
                <span className="n">{ago(Date.parse(job.askedAt))}</span>
                <span className="n">{job.durationMs ? duration(job.durationMs) : job.endedAt ? "" : job.state}</span>
                <span className="n">{cost(job.cost) ?? ""}</span>
              </li>
            ))}
            <li className="total">
              <span className="t">
                {jobs.filter((j) => j.kind === "run").length} {jobs.filter((j) => j.kind === "run").length === 1 ? "job" : "jobs"} in all
              </span>
              <span />
              <span />
              <span className="n">{cost(spent)}</span>
            </li>
          </ul>
        ) : (
          <p className="empty">Nothing yet.</p>
        )}
      </section>

      <section>
        <header>
          <button className="btn ghost sm danger" onClick={() => setLeaving(true)}>
            Let {coworker.name} go
          </button>
        </header>
      </section>
      {leaving ? (
        <Confirm
          title={`Let ${coworker.name} go?`}
          body="Its Computer is deleted for good, with its sign-ins and skills, and its threads are removed here."
          action={`Let ${coworker.name} go`}
          onConfirm={async () => {
            if ((await act(() => call(url, { method: "DELETE" }))) !== undefined) router.replace("/");
          }}
          onClose={() => setLeaving(false)}
        />
      ) : null}
    </div>
  );
}
