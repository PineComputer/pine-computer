"use client";

import { PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JobView } from "@/shared/api";
import { fold } from "@/shared/fold";
import { call, enc } from "../common/api";
import { Avatar, Confirm } from "../common/kit";
import { useWorkspace } from "../app/Workspace";
import { Profile } from "../coworker/Profile";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { Screen } from "./Screen";
import { SkillDraft } from "./SkillDraft";
import { useThreadStream } from "./useThreadStream";

const WORKING = new Set(["queued", "starting", "running", "canceling"]);

/** A thread: the conversation with its coworker, and the coworker's screen beside it. */
export function ThreadView({ id }: { id: string }) {
  const { ws, act } = useWorkspace();
  const router = useRouter();
  const thread = ws.threads.find((t) => t.id === id);
  const coworker = ws.coworkers.find((c) => c.id === thread?.coworker);
  const jobs = useMemo(() => ws.jobs.filter((j) => j.thread === id), [ws.jobs, id]);
  const { events, idleDeadline } = useThreadStream(id, thread?.stream ?? null);
  const work = useMemo(() => fold(events), [events]);
  const [panel, setPanel] = useState<"screen" | "profile" | null>("screen");
  const [controlBusy, setControlBusy] = useState(false);
  const [review, setReview] = useState<JobView | null>(null);
  const [closing, setClosing] = useState(false);

  // Keep the newest message in view as the work arrives, unless the person scrolled up.
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [events.length, jobs]);

  useEffect(() => {
    if (!thread) router.replace("/");
  }, [thread, router]);
  if (!thread || !coworker) return null;

  const last = jobs.at(-1);
  const mode = last?.state === "needs_input" ? "answer" : last && WORKING.has(last.state) ? (last.turnId ? "steer" : "wait") : "job";
  const base = `/api/threads/${enc(id)}`;
  const jobAction = (job: JobView, action: string, text?: string) => act(() => call(`${base}/jobs/${enc(job.id)}`, { body: { action, text } })).then((done) => done !== undefined);
  const send = (text: string) => {
    if (mode === "job") return act(() => call(`${base}/jobs`, { body: { goal: text, key: crypto.randomUUID() } })).then((done) => done !== undefined);
    return jobAction(last!, "steer", text);
  };
  const control = async (action: "take" | "release") => {
    setControlBusy(true);
    await act(() => call(`${base}/control`, { body: { action } }));
    setControlBusy(false);
  };

  return (
    <main className="main" data-panel={panel ? "open" : "closed"}>
      <section className="col" aria-label={`Thread with ${coworker.name}`}>
        <header className="bar">
          <Avatar name={coworker.name} color={coworker.color} size="sm" />
          <h1>{coworker.name}</h1>
          <span className="sub">{thread.title}</span>
          <span className="end">
            <button className="btn ghost sm icon" title="Close this thread" aria-label="Close this thread" onClick={() => setClosing(true)}>
              <Trash2 />
            </button>
            {panel ? null : (
              <button className="btn ghost sm icon" title="Show the screen" aria-label="Show the screen" onClick={() => setPanel("screen")}>
                <PanelRightOpen />
              </button>
            )}
          </span>
        </header>
        <div
          className="log"
          ref={log}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="log-in">
            <Conversation
              coworker={coworker}
              jobs={jobs}
              work={work}
              actions={{
                onAnswer: (job, text) => jobAction(job, "answer", text),
                onStop: (job) => void jobAction(job, "cancel"),
                onLearn: thread.stream ? (job, text) => jobAction(job, "learn", text) : undefined,
                onReview: setReview,
              }}
            />
          </div>
        </div>
        {/* While it asks, the question's own reply box is the way to answer. */}
        {mode === "answer" ? <span /> : <Composer mode={mode} name={coworker.name} onSend={send} onStop={mode !== "job" && last ? () => void jobAction(last, "cancel") : undefined} />}
      </section>

      {panel ? (
        <section className="col" aria-label={panel === "screen" ? `${coworker.name}'s screen` : `${coworker.name}'s profile`}>
          <header className="bar">
            <div className="seg">
              <button aria-pressed={panel === "screen"} onClick={() => setPanel("screen")}>
                Screen
              </button>
              <button aria-pressed={panel === "profile"} onClick={() => setPanel("profile")}>
                Profile
              </button>
            </div>
            <span className="end">
              <button className="btn ghost sm icon" title="Hide this panel" aria-label="Hide this panel" onClick={() => setPanel(null)}>
                <PanelRightClose />
              </button>
            </span>
          </header>
          {panel === "screen" ? (
            <Screen
              coworker={coworker}
              thread={thread}
              jobs={jobs}
              work={work}
              idleDeadline={idleDeadline}
              controlBusy={controlBusy}
              onControl={(action) => void control(action)}
              onStart={() => act(() => call(`/api/coworkers/${enc(coworker.id)}`, { body: { action: "start" } }))}
            />
          ) : (
            <Profile coworker={coworker} />
          )}
        </section>
      ) : null}

      {review?.learn?.name ? <SkillDraft coworker={coworker} name={review.learn.name} version={review.learn.version ?? 1} onClose={() => setReview(null)} /> : null}
      {closing ? (
        <Confirm
          title="Close this thread?"
          body={`Its session on ${coworker.name}'s computer ends, and the thread's history and files are removed here.`}
          action="Close thread"
          onConfirm={() => act(() => call(base, { method: "DELETE" }))}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </main>
  );
}
