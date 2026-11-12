"use client";

import { BarChart3, FileSpreadsheet, MoreHorizontal, Newspaper, Radar, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/brand";
import { call, enc, errorText } from "../common/api";
import { Confirm } from "../common/kit";
import { useApp } from "../app/AppProvider";
import { AuthorCard, TeachOffer, type Authoring } from "./Author";
import { Composer, type ComposerMode } from "./Composer";
import { DrivePanel } from "./DrivePanel";
import { fold } from "./fold";
import { Stage } from "./Stage";
import { Terminal } from "./Terminal";
import { Thread } from "./Thread";
import { useSessionStream } from "./useSessionStream";

// Jobs that take a whole computer: reading across sites, working in the shell, and
// leaving a file behind. Each fills the box, to change or send.
const TRIES = [
  {
    icon: BarChart3,
    title: "Chart a company's results",
    detail: "SEC filings → a chart and a summary",
    task: "Find Apple's last three annual reports (10-K) on SEC EDGAR, pull net sales and net income for each year, chart them, and save the chart with a short summary in the work directory.",
  },
  {
    icon: FileSpreadsheet,
    title: "Compare pricing pages",
    detail: "Three sites → a spreadsheet",
    task: "Compare the pricing pages of Vercel, Netlify and Cloudflare Pages: each plan, its monthly price and what it includes. Save it as a spreadsheet in the work directory and tell me which is cheapest for a team of five.",
  },
  {
    icon: Newspaper,
    title: "Brief a team on Hacker News",
    detail: "Today's top stories → a short deck",
    task: "Read today's top ten Hacker News stories and the pages they link to, then make a five-slide deck on the three that matter most to a software team, with a link on each slide. Save it in the work directory.",
  },
  {
    icon: Radar,
    title: "Watch for a change",
    detail: "A page → a note when it moves",
    task: "Open https://status.openai.com and tell me whether anything is degraded right now. Save a one-line status note to status.md.",
  },
];

export function SessionView({ name }: { name: string }) {
  const { app, refresh, toast } = useApp();
  const router = useRouter();
  const session = app?.sessions.find((s) => s.name === name);
  const computer = app?.computer;
  const open = Boolean(session?.open);
  const stream = open && computer?.sandboxId ? `${name}:${computer.sandboxId}` : null;
  const { events, control, handoffs, problem: streamProblem, controlCursor } = useSessionStream(name, stream);
  const turns = useMemo(() => fold(events), [events]);
  const saved = useMemo(() => app?.turns.filter((t) => t.session === name) ?? [], [app?.turns, name]);
  const last = turns[turns.length - 1];

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [panel, setPanel] = useState<"shell" | "agent" | null>(null);
  const [peek, setPeek] = useState<{ src: string; title: string } | null>(null);
  const [authoring, setAuthoring] = useState<Authoring | null>(null);
  const [teach, setTeach] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [closing, setClosing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // The key of the message being sent: a retry after a lost response sends the same
  // key, and the Computer returns the turn it already started.
  const messageKey = useRef<string | null>(null);
  const tookAt = useRef<number | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const driving = control.controller === "human";
  const drivenElsewhere = Boolean(control.humanSession && control.humanSession !== name);
  const working = Boolean(open && last && !last.outcome);
  const mode: ComposerMode = !open ? "off" : working ? "steer" : last?.outcome?.reason === "needs_input" ? "answer" : "run";

  // A handoff saved after this page took the controls: offer to teach from it.
  useEffect(() => {
    const fresh = handoffs.filter((h) => tookAt.current !== null && h.cursor > tookAt.current).at(-1);
    if (fresh) {
      tookAt.current = null;
      setTeach(fresh.id);
    }
  }, [handoffs]);

  // Follow the work as it arrives, unless you've scrolled up to read.
  useEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events.length, saved.length, authoring, teach]);

  // The page's own record of a finished turn comes from the worker; look once it ends.
  const ended = turns.filter((t) => t.outcome).length;
  useEffect(() => {
    if (ended) void refresh();
  }, [ended, refresh]);

  const submit = async () => {
    setProblem(null);
    try {
      if (mode === "run") {
        messageKey.current ??= crypto.randomUUID();
        await call(`/api/sessions/${enc(name)}/runs`, { body: { goal: text, key: messageKey.current, attachments } });
        setAttachments([]);
      } else {
        await call(`/api/sessions/${enc(name)}/turns/${enc(last!.id)}`, { body: { action: mode, text } });
      }
      messageKey.current = null;
      setText("");
      pinned.current = true;
      await refresh();
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  const cancel = async () => {
    try {
      await call(`/api/sessions/${enc(name)}/turns/${enc(last!.id)}`, { body: { action: "cancel" } });
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  const takeOrRelease = async (action: "take" | "release") => {
    setControlBusy(true);
    try {
      if (action === "take") tookAt.current = controlCursor.current;
      await call(`/api/sessions/${enc(name)}/control`, { body: { action } });
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setControlBusy(false);
    }
  };

  const author = async (body: Record<string, unknown>, kind: Authoring["kind"]) => {
    try {
      const run = await call<{ authorId: string; handoffId: string }>(`/api/sessions/${enc(name)}/author`, { body });
      setAuthoring({ authorId: run.authorId, kind, goal: body.goal as string | undefined, handoffId: run.handoffId || (body.handoffId as string | undefined) });
      setTeach(null);
    } catch (error) {
      toast({ tone: "failed", title: "It couldn't start", text: errorText(error) });
    }
  };

  const newConversation = useCallback(async () => {
    try {
      await call(`/api/sessions/${enc(name)}/conversation`, { method: "DELETE" });
      toast({ tone: "done", text: "New conversation. The agent starts fresh; your history stays here." });
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    }
  }, [name, toast]);

  // What the command palette asks of this view.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      if (command === "terminal") setPanel((p) => (p === "shell" ? null : "shell"));
      else if (command === "composer") composer.current?.focus();
      else if (command === "open-url") urlField.current?.focus();
      else if (command === "new-conversation") void newConversation();
    };
    window.addEventListener("session-command", onCommand);
    return () => window.removeEventListener("session-command", onCommand);
  }, [newConversation]);

  if (app && !session) {
    return (
      <div className="page">
        <div className="hero">
          <div className="screen-msg">
            <h2>There&apos;s no session called {name}</h2>
            <p>It may have been closed.</p>
            <button className="btn" onClick={() => router.push("/")}>
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!app || !session) return null;

  const empty = turns.length === 0 && saved.length === 0;

  return (
    <div className="sess">
      <section className="thread" aria-label="Conversation">
        <div className="thread-head">
          {renaming ? (
            <input
              autoFocus
              defaultValue={session.label}
              aria-label="Session name"
              onBlur={async (event) => {
                setRenaming(false);
                const label = event.target.value.trim();
                if (label && label !== session.label) {
                  await call(`/api/sessions/${enc(name)}`, { method: "PATCH", body: { label } }).catch(() => undefined);
                  await refresh();
                }
              }}
              onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            />
          ) : (
            <h1 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {session.label}
            </h1>
          )}
          {working ? (
            <span className="badge accent">
              <span className="dot" data-tone="agent" /> Working
            </span>
          ) : mode === "answer" ? (
            <span className="badge human">Needs you</span>
          ) : null}
          <div className="end" style={{ position: "relative" }}>
            <button className="btn ghost icon sm" aria-label="Session menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal />
            </button>
            {menu ? (
              <div className="vault-pop" style={{ top: "calc(100% + 6px)", bottom: "auto", left: "auto", right: 0 }} onMouseLeave={() => setMenu(false)}>
                <button disabled={!open || working} onClick={() => (setMenu(false), void newConversation())}>
                  New conversation
                </button>
                <button onClick={() => (setMenu(false), setRenaming(true))}>Rename</button>
                <button disabled={(app.sessions.length ?? 0) <= 1} onClick={() => (setMenu(false), setClosing(true))} style={{ color: "var(--bad)" }}>
                  <Trash2 size={12} /> Close session
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="log"
          ref={log}
          role="log"
          aria-label={`${brand.agent}'s work and answers`}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {empty ? (
            <div className="starter">
              <h2>
                What should {brand.agent}
                <br />
                do next?
              </h2>
              <p>Describe a job in plain words. It works in its own browser and shell on the right; take the controls any time.</p>
              <ul className="tries" aria-label="Examples">
                {TRIES.map(({ icon: Icon, title, detail, task }) => (
                  <li key={title}>
                    <button
                      type="button"
                      disabled={mode === "off"}
                      onClick={() => {
                        setText(task);
                        messageKey.current = null;
                        composer.current?.focus();
                      }}
                    >
                      <span className="ico">
                        <Icon />
                      </span>
                      <b>{title}</b>
                      <span>{detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Thread
              turns={turns}
              saved={saved}
              running={open}
              onPeek={(src, title) => setPeek({ src, title })}
              onLearn={open && !authoring ? () => void author({ kind: "learn" }, "learn") : undefined}
            />
          )}
          {authoring ? (
            <AuthorCard
              key={authoring.authorId}
              session={name}
              run={authoring}
              onClose={() => setAuthoring(null)}
              onClarify={(answers) => author({ kind: "teach", goal: authoring.goal, handoffId: authoring.handoffId, clarifications: answers }, "teach")}
            />
          ) : null}
          {teach ? (
            <TeachOffer session={name} handoffId={teach} onClose={() => setTeach(null)} onTeach={(goal) => author({ kind: "teach", goal, handoffId: teach }, "teach")} />
          ) : null}
        </div>

        <div>
          {problem || streamProblem ? (
            <p className="problem" role="alert" style={{ margin: "0 14px 8px" }}>
              {problem ?? streamProblem}
            </p>
          ) : null}
          <Composer
            ref={composer}
            session={name}
            mode={mode}
            text={text}
            onText={(next) => {
              setText(next);
              messageKey.current = null; // edited text is a new message
            }}
            attachments={attachments}
            onAttachments={setAttachments}
            onSubmit={submit}
            onCancel={cancel}
            onProblem={setProblem}
          />
        </div>
      </section>

      <Stage
        ref={urlField}
        session={name}
        pulse={events.length}
        stream={stream}
        state={computer?.state ?? "stopped"}
        working={working}
        driving={driving}
        drivenElsewhere={drivenElsewhere}
        idleDeadline={control.idlePaused ? undefined : control.idleDeadline}
        controlBusy={controlBusy}
        onControl={(action) => void takeOrRelease(action)}
        panel={panel}
        onPanel={setPanel}
        peek={peek}
        onPeekClose={() => setPeek(null)}
      >
        {panel === "shell" && stream ? <Terminal session={name} label={session.label} onClose={() => setPanel(null)} autoFocus /> : null}
        {panel === "agent" && stream ? <DrivePanel session={name} label={session.label} available={app.ownAgent} onClose={() => setPanel(null)} /> : null}
      </Stage>

      {closing ? (
        <Confirm
          title={`Close ${session.label}?`}
          body="Its browser window, shell and work directory go, and so does its history in this app. Other sessions, sign-ins and skills stay."
          action="Close session"
          onClose={() => setClosing(false)}
          onConfirm={async () => {
            await call(`/api/sessions/${enc(name)}`, { method: "DELETE" });
            await refresh();
            router.push(`/s/${app.sessions.find((s) => s.name !== name)?.name ?? ""}`);
          }}
        />
      ) : null}
    </div>
  );
}
