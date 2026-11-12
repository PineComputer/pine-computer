"use client";

import { AlertTriangle, BookOpen, Check, FileCode2, Power, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillsState, SkillVersionView, SkillView } from "@/shared/api";
import type { Outcome } from "@/shared/events";
import { useApp } from "../app/AppProvider";
import { call, enc, errorText } from "../common/api";
import { duration, relative } from "../common/format";
import { Confirm, Switch, useNow } from "../common/kit";
import { Markdown } from "../common/Markdown";
import { useAuthorRun } from "./useAuthorRun";
import "./skills.css";

type Selection = { kind: "learned"; name: string; version: number } | { kind: "pine"; name: string };

interface LearnedSkill {
  name: string;
  versions: SkillVersionView[];
  active?: SkillVersionView;
}

export function SkillsView() {
  return (
    <Suspense fallback={null}>
      <Skills />
    </Suspense>
  );
}

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Draft", tone: "accent" },
  active: { label: "Active", tone: "solid" },
  inactive: { label: "Inactive", tone: "" },
  deleted: { label: "Deleted", tone: "bad" },
};

function Skills() {
  const { app, refresh, toast, lifecycle, busy } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const running = app?.computer?.state === "running";
  const [state, setState] = useState<SkillsState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const next = await call<SkillsState>("/api/skills");
      setState(next);
      setProblem(null);
      // Drafts arrive with their SKILL.md.
      setBodies((known) => ({ ...known, ...Object.fromEntries(next.drafts.filter((d) => d.body).map((d) => [`${d.name}@${d.version}`, d.body!])) }));
      return next;
    } catch (error) {
      setProblem(errorText(error));
      return null;
    }
  }, []);

  // The sidebar's count of drafts moves when one arrives: read the list again then.
  const drafts = app?.drafts;
  useEffect(() => {
    if (running) void load();
    else setState(null);
  }, [running, drafts, load]);

  const learned = useMemo<LearnedSkill[]>(() => {
    if (!state) return [];
    const byName = new Map<string, Map<number, SkillVersionView>>();
    for (const v of [...state.versions, ...state.drafts]) {
      const versions = byName.get(v.name) ?? new Map<number, SkillVersionView>();
      versions.set(v.version, { ...versions.get(v.version), ...v });
      byName.set(v.name, versions);
    }
    return [...byName]
      .map(([name, versions]) => {
        const list = [...versions.values()].filter((v) => v.status !== "deleted").sort((a, b) => b.version - a.version);
        return { name, versions: list, active: list.find((v) => v.status === "active") };
      })
      .filter((s) => s.versions.length)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state]);

  const pine = useMemo(() => (state?.skills ?? []).filter((s) => s.origin === "pine"), [state]);
  const reviewed = learned.filter((s) => s.versions.some((v) => v.status !== "pending"));

  // ?select=name@version picks a skill, as a session links to its new draft.
  const wanted = params.get("select");
  useEffect(() => {
    if (!state || !wanted) return;
    const [name, version] = wanted.split("@");
    const skill = learned.find((s) => s.name === name);
    if (skill) {
      // The draft may have been activated or discarded since the link was made.
      const shown = skill.versions.find((v) => v.version === Number(version)) ?? skill.active ?? skill.versions[0];
      setSelection({ kind: "learned", name, version: shown.version });
    } else if (pine.some((s) => s.name === name)) setSelection({ kind: "pine", name });
  }, [state, wanted, learned, pine]);

  // A discarded or deleted version leaves nothing to show: fall back to the first skill.
  useEffect(() => {
    if (!state || wanted || selection?.kind !== "learned") return;
    const exists = learned.some((s) => s.name === selection.name && s.versions.some((v) => v.version === selection.version));
    if (!exists) setSelection(null);
  }, [state, wanted, selection, learned]);

  // Otherwise the first draft, or the first skill.
  useEffect(() => {
    if (!state || selection || wanted) return;
    const first = state.drafts[0] ?? reviewed[0]?.active ?? reviewed[0]?.versions[0];
    if (first) setSelection({ kind: "learned", name: first.name, version: first.version });
    else if (pine[0]) setSelection({ kind: "pine", name: pine[0].name });
  }, [state, selection, wanted, reviewed, pine]);

  const select = (next: Selection) => {
    setSelection(next);
    if (wanted) router.replace("/skills");
  };

  const setBody = useCallback((id: string, body: string) => setBodies((known) => ({ ...known, [id]: body })), []);

  const settled = async (draft?: { name: string; version: number }) => {
    await Promise.all([load(), refresh()]);
    if (draft) setSelection({ kind: "learned", name: draft.name, version: draft.version });
  };

  return (
    <div className="page">
      <div className="page-in">
        <header className="page-head">
          <div>
            <h1>Skills</h1>
            <p>
              What the agent knows how to do. Learned skills come from saving a good run, or teaching by showing it, in a session; nothing reaches an agent
              until you activate it.
            </p>
          </div>
          {running ? (
            <div className="end">
              <button className="btn ghost" onClick={() => void load()}>
                <RefreshCw /> Refresh
              </button>
            </div>
          ) : null}
        </header>

        {!running ? (
          <div className="card skills-off">
            <div className="skills-off-mark">
              <Sparkles />
            </div>
            <h2>Skills live on your Computer</h2>
            <p>
              They are saved with it, so every Stop and Start keeps them. Start the Computer to review drafts, switch built-in skills on or off, and refine
              what it learned.
            </p>
            {app?.computer?.state === "stopped" ? (
              <button className="btn primary" aria-busy={busy === "start"} disabled={busy !== null} onClick={() => void lifecycle("start")}>
                Start the Computer
              </button>
            ) : !app?.computer ? (
              <button className="btn primary" onClick={() => router.push("/")}>
                Create a Computer
              </button>
            ) : null}
          </div>
        ) : problem && !state ? (
          <p className="problem">{problem}</p>
        ) : !state ? (
          <div className="skills-grid">
            <div className="card skills-list skeleton-block" />
            <div className="card skeleton-block" style={{ minHeight: 420 }} />
          </div>
        ) : (
          <div className="skills-grid">
            <nav className="card skills-list" aria-label="Skills">
              <Group title="Waiting for review" count={state.drafts.length}>
                {state.drafts.length ? (
                  state.drafts.map((d) => (
                    <button
                      key={`${d.name}@${d.version}`}
                      className="skill-item draft"
                      aria-current={selection?.kind === "learned" && selection.name === d.name && selection.version === d.version}
                      onClick={() => select({ kind: "learned", name: d.name, version: d.version })}
                    >
                      <span className="skill-glyph accent">
                        <Sparkles />
                      </span>
                      <span className="skill-text">
                        <b>{d.name}</b>
                        <small>
                          v{d.version} · {d.createdAt ? relative(Date.parse(d.createdAt)) : "new"}
                          {d.tainted ? " · touched a sign-in" : ""}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="skills-none">No drafts. A new one appears here after you save a run or teach one.</p>
                )}
              </Group>

              <Group title="Learned" count={reviewed.length}>
                {reviewed.length ? (
                  reviewed.map((s) => {
                    const shown = s.active ?? s.versions.find((v) => v.status !== "pending") ?? s.versions[0];
                    return (
                      <button
                        key={s.name}
                        className="skill-item"
                        aria-current={selection?.kind === "learned" && selection.name === s.name && !s.versions.some((v) => v.status === "pending" && v.version === selection.version)}
                        onClick={() => select({ kind: "learned", name: s.name, version: shown.version })}
                      >
                        <span className="skill-glyph">
                          <BookOpen />
                        </span>
                        <span className="skill-text">
                          <b>{s.name}</b>
                          <small>{s.active ? `v${s.active.version} active` : "Not in use"}</small>
                        </span>
                        <span className="dot" data-tone={s.active ? "ok" : undefined} />
                      </button>
                    );
                  })
                ) : (
                  <p className="skills-none">
                    None yet. In a session, save a good run as a skill, or take the controls, show it once, and teach it.
                  </p>
                )}
              </Group>

              <Group title="Built in" count={pine.length}>
                {pine.map((s) => (
                  <button
                    key={s.name}
                    className="skill-item"
                    aria-current={selection?.kind === "pine" && selection.name === s.name}
                    onClick={() => select({ kind: "pine", name: s.name })}
                  >
                    <span className="skill-glyph">
                      <FileCode2 />
                    </span>
                    <span className="skill-text">
                      <b>{s.name}</b>
                      <small>{s.switchable ? (s.enabled === false ? "Off" : "On") : "Always on"}</small>
                    </span>
                    {s.switchable ? <span className="dot" data-tone={s.enabled === false ? undefined : "ok"} /> : null}
                  </button>
                ))}
              </Group>
            </nav>

            <section className="skills-detail">
              {problem ? <p className="problem">{problem}</p> : null}
              {selection?.kind === "learned" ? (
                <LearnedDetail
                  key={`${selection.name}@${selection.version}`}
                  skill={learned.find((s) => s.name === selection.name)}
                  version={selection.version}
                  bodies={bodies}
                  setBody={setBody}
                  onSelect={(version) => select({ kind: "learned", name: selection.name, version })}
                  onSettled={settled}
                  toast={toast}
                />
              ) : selection?.kind === "pine" ? (
                <PineDetail
                  key={selection.name}
                  skill={pine.find((s) => s.name === selection.name)}
                  body={bodies[`pine:${selection.name}`]}
                  setBody={(body) => setBody(`pine:${selection.name}`, body)}
                  onSettled={settled}
                  toast={toast}
                />
              ) : (
                <div className="card empty-note">Choose a skill to read it.</div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="skills-group">
      <div className="skills-group-head">
        {title}
        <span className="mono">{count}</span>
      </div>
      {children}
    </div>
  );
}

type ToastFn = ReturnType<typeof useApp>["toast"];

function LearnedDetail({
  skill,
  version,
  bodies,
  setBody,
  onSelect,
  onSettled,
  toast,
}: {
  skill: LearnedSkill | undefined;
  version: number;
  bodies: Record<string, string>;
  setBody: (id: string, body: string) => void;
  onSelect: (version: number) => void;
  onSettled: (draft?: { name: string; version: number }) => Promise<void>;
  toast: ToastFn;
}) {
  const record = skill?.versions.find((v) => v.version === version);
  const id = `${skill?.name}@${version}`;
  const body = bodies[id];
  const [acting, setActing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "deactivate" | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!skill || body !== undefined || asked.current) return;
    asked.current = true;
    call<SkillVersionView>(`/api/skills/${enc(skill.name)}/versions/${version}`)
      .then((v) => setBody(id, v.body ?? ""))
      .catch((error) => toast({ tone: "failed", text: errorText(error) }));
  }, [skill, version, body, id, setBody, toast]);

  if (!skill || !record) return <div className="card empty-note">That version is gone.</div>;
  const name = skill.name;
  const status = STATUS[record.status] ?? { label: record.status, tone: "" };

  const act = async (what: string, run: () => Promise<unknown>, done: string) => {
    setActing(what);
    try {
      await run();
      toast({ tone: "done", text: done });
      await onSettled();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setActing(null);
    }
  };

  const activate = () =>
    act("activate", () => call(`/api/skills/${enc(name)}/versions/${version}`, { body: { action: "activate" } }), `${name} v${version} is active. Agents use it from their next task.`);

  return (
    <>
      <article className="card">
        <header className="skill-head">
          <div className="skill-title">
            <h2>{name}</h2>
            <span className="badge mono">v{version}</span>
            <span className={`badge ${status.tone}`}>{status.label}</span>
          </div>
          <div className="skill-actions">
            {record.status !== "active" ? (
              <button className="btn primary sm" aria-busy={acting === "activate"} disabled={acting !== null} onClick={() => void activate()}>
                <Check /> {record.status === "pending" ? "Activate" : "Activate this version"}
              </button>
            ) : (
              <button className="btn sm" disabled={acting !== null} onClick={() => setConfirm("deactivate")}>
                <Power /> Deactivate
              </button>
            )}
            <button className="btn danger sm" disabled={acting !== null} onClick={() => setConfirm("delete")}>
              {record.status === "pending" ? <X /> : <Trash2 />} {record.status === "pending" ? "Discard" : "Delete version"}
            </button>
          </div>
        </header>
        {record.tainted ? (
          <div className="skill-warn">
            <AlertTriangle />
            <span>
              The run behind it touched a sign-in, MFA or payment field, so it&apos;s never activated by itself. Read it through before you activate it.
            </span>
          </div>
        ) : null}
        <dl className="kv skill-meta">
          <dt>Created</dt>
          <dd>{record.createdAt ? new Date(record.createdAt).toLocaleString() : "—"}</dd>
          {record.activatedAt ? (
            <>
              <dt>First activated</dt>
              <dd>{new Date(record.activatedAt).toLocaleString()}</dd>
            </>
          ) : null}
          {record.origin ? (
            <>
              <dt>Learned on</dt>
              <dd className="mono">{record.origin}</dd>
            </>
          ) : null}
          {record.reason ? (
            <>
              <dt>Why</dt>
              <dd>{record.reason}</dd>
            </>
          ) : null}
        </dl>
        <SkillBody body={body} />
      </article>

      {skill.versions.length > 1 ? (
        <section className="card">
          <header className="card-head">
            <h3>Versions</h3>
          </header>
          <ol className="skill-versions">
            {skill.versions.map((v) => (
              <li key={v.version}>
                <button aria-current={v.version === version} onClick={() => onSelect(v.version)}>
                  <span className="dot" data-tone={v.status === "active" ? "ok" : v.status === "pending" ? "agent" : undefined} />
                  <b className="mono">v{v.version}</b>
                  <span className={`badge ${STATUS[v.status]?.tone ?? ""}`}>{STATUS[v.status]?.label ?? v.status}</span>
                  <small>{v.createdAt ? relative(Date.parse(v.createdAt)) : ""}</small>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Refine name={name} version={version} onDraft={(draft) => onSettled(draft)} toast={toast} />

      {confirm === "delete" ? (
        <Confirm
          title={record.status === "pending" ? `Discard ${name} v${version}?` : `Delete ${name} v${version}?`}
          body={
            record.status === "active"
              ? "It stops being served to agents. Its other versions stay."
              : record.status === "pending"
                ? "The draft goes, and no agent ever sees it."
                : "The version is hidden for good. Its other versions stay."
          }
          action={record.status === "pending" ? "Discard" : "Delete"}
          onClose={() => setConfirm(null)}
          onConfirm={() => act("delete", () => call(`/api/skills/${enc(name)}/versions/${version}`, { method: "DELETE" }), `${name} v${version} deleted.`)}
        />
      ) : confirm === "deactivate" ? (
        <Confirm
          title={`Deactivate ${name}?`}
          body="Agents stop using it from their next task. Its versions stay, so you can activate one again."
          action="Deactivate"
          onClose={() => setConfirm(null)}
          onConfirm={() => act("deactivate", () => call(`/api/skills/${enc(name)}`, { method: "DELETE" }), `${name} is no longer in use.`)}
        />
      ) : null}
    </>
  );
}

function PineDetail({
  skill,
  body,
  setBody,
  onSettled,
  toast,
}: {
  skill: SkillView | undefined;
  body: string | undefined;
  setBody: (body: string) => void;
  onSettled: () => Promise<void>;
  toast: ToastFn;
}) {
  const [switching, setSwitching] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (!skill || body !== undefined || asked.current) return;
    asked.current = true;
    call<{ body?: string }>(`/api/skills/${enc(skill.name)}`)
      .then((s) => setBody(typeof s.body === "string" ? s.body : ""))
      .catch((error) => toast({ tone: "failed", text: errorText(error) }));
  }, [skill, body, setBody, toast]);

  if (!skill) return <div className="card empty-note">That skill is gone.</div>;
  const on = skill.enabled !== false;
  return (
    <article className="card">
      <header className="skill-head">
        <div className="skill-title">
          <h2>{skill.name}</h2>
          <span className="badge">Built in</span>
        </div>
        {skill.switchable ? (
          <label className="skill-switch">
            <span>{on ? "On" : "Off"}</span>
            <Switch
              label={`Offer ${skill.name} to agents`}
              checked={on}
              disabled={switching}
              onChange={async (next) => {
                setSwitching(true);
                try {
                  await call(`/api/skills/${enc(skill.name)}`, { method: "PUT", body: { enabled: next } });
                  toast({ tone: "done", text: `${skill.name} is ${next ? "on" : "off"} for the agents this Computer starts next.` });
                  await onSettled();
                } catch (error) {
                  toast({ tone: "failed", text: errorText(error) });
                } finally {
                  setSwitching(false);
                }
              }}
            />
          </label>
        ) : null}
      </header>
      <p className="skill-desc">{skill.description}</p>
      {skill.switchable ? <p className="skill-note">Switching applies to the agents this Computer starts next; a task already running keeps what it had.</p> : null}
      <SkillBody body={body} />
    </article>
  );
}

/** SKILL.md, read as a page, with its frontmatter and source a click away. */
function SkillBody({ body }: { body: string | undefined }) {
  const [source, setSource] = useState(false);
  if (body === undefined) {
    return (
      <div className="skill-body">
        <div className="skeleton-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  const meta = match?.[1] ?? "";
  const text = match ? body.slice(match[0].length) : body;
  return (
    <div className="skill-body">
      <div className="skill-body-bar">
        <span className="mono">SKILL.md</span>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={!source} onClick={() => setSource(false)}>
            Read
          </button>
          <button role="tab" aria-selected={source} onClick={() => setSource(true)}>
            Source
          </button>
        </div>
      </div>
      {source ? (
        <pre className="skill-source">{body}</pre>
      ) : (
        <>
          {meta ? <pre className="skill-front">{meta}</pre> : null}
          {text.trim() ? <Markdown text={text} /> : <p className="muted">It has no instructions beyond its description.</p>}
        </>
      )}
    </div>
  );
}

/** Revises a version with guidance: a new draft, written by the authoring model. */
function Refine({ name, version, onDraft, toast }: { name: string; version: number; onDraft: (draft: { name: string; version: number }) => Promise<void>; toast: ToastFn }) {
  const { app } = useApp();
  const sessions = useMemo(() => (app?.sessions ?? []).filter((s) => s.open), [app?.sessions]);
  const [session, setSession] = useState(sessions[0]?.name ?? "");
  const [guidance, setGuidance] = useState("");
  const [starting, setStarting] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!sessions.some((s) => s.name === session) && sessions[0]) setSession(sessions[0].name);
  }, [sessions, session]);

  const onOutcome = useCallback(
    (outcome: Outcome) => {
      const draft = outcome.author?.draft;
      if (draft) {
        toast({ tone: "done", text: `Draft ready: ${draft.name} v${draft.version}` });
        setGuidance("");
        void onDraft(draft);
      }
    },
    [onDraft, toast],
  );
  const { run, follow, cancel, clear } = useAuthorRun(onOutcome);

  const start = async () => {
    setStarting(true);
    try {
      const { authorId } = await call<{ authorId: string }>(`/api/sessions/${enc(session)}/author`, {
        body: { kind: "refine", skill: name, version, guidance },
      });
      follow(session, authorId);
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setStarting(false);
    }
  };

  const outcome = run?.outcome;
  const working = run !== null && !run.done;

  return (
    <section className="card refine">
      <header className="card-head">
        <Wand2 size={15} style={{ color: "var(--accent-text)" }} />
        <h3>Refine</h3>
        <span className="end muted" style={{ fontSize: 12 }}>
          Writes a new draft from v{version}; this one stays as it is
        </span>
      </header>
      <div className="card-body">
        {run ? (
          <div className={`author-run${working ? " live" : ""}`}>
            <div className="author-run-head">
              {working ? <span className="spinner" /> : <span className="dot" data-tone={outcome?.author?.draft ? "ok" : run.problem || outcome ? "bad" : undefined} />}
              <b>
                {working
                  ? "Writing a new draft"
                  : outcome?.author?.draft
                    ? `Draft ready: v${outcome.author.draft.version}`
                    : run.problem
                      ? "It stopped"
                      : outcome?.author?.questions.length
                        ? "It has questions"
                        : "No new draft"}
              </b>
              <span className="mono muted">{duration((run.endedAt ?? now) - run.startedAt)}</span>
              <div className="author-run-acts">
                {working ? (
                  <button className="btn ghost sm" onClick={() => void cancel()}>
                    Cancel
                  </button>
                ) : (
                  <button className="btn ghost sm" onClick={clear}>
                    Done
                  </button>
                )}
              </div>
            </div>
            {run.lines.length ? (
              <ul className="author-lines">
                {run.lines.slice(-8).map((line) => (
                  <li key={line.id} data-state={line.state}>
                    {line.text}
                  </li>
                ))}
              </ul>
            ) : working ? (
              <p className="muted">The authoring model is reading this version and your guidance. It usually takes a minute or two.</p>
            ) : null}
            {run.problem ? <p className="problem">{run.problem}</p> : null}
            {outcome && !outcome.author?.draft ? (
              <div className="author-outcome">
                {outcome.summary ? <Markdown text={outcome.summary} /> : null}
                {outcome.author?.questions.length ? (
                  <ul>
                    {outcome.author.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {!working ? (
          <>
            <label className="field">
              <span>What should change?</span>
              <textarea
                className="textarea"
                placeholder="Say what it got wrong or should do differently: “Search by order number, not by date”, “Skip the newsletter pop-up”…"
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
              />
            </label>
            <div className="refine-bar">
              {sessions.length > 1 ? (
                <label className="refine-session">
                  <span className="muted">Write it in</span>
                  <select className="select" value={session} onChange={(event) => setSession(event.target.value)}>
                    {sessions.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!sessions.length ? <span className="muted">Open a session to refine skills.</span> : null}
              <button className="btn primary" aria-busy={starting} disabled={starting || !guidance.trim() || !session} onClick={() => void start()}>
                <Wand2 /> Refine
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
