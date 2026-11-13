"use client";

// The right of a thread, and its hero: the coworker's live desktop as wide as the
// column, a line above it that says what the coworker is doing, and under it the trail:
// the screens this job left behind, and the files it made. A screen or a file from the
// trail opens in place of the live desktop. When the Computer is stopped, the last
// screen stays, dimmed.

import { ArrowLeft, Hand, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CoworkerView, JobView, ThreadView } from "@/shared/api";
import type { Work } from "@/shared/fold";
import { doing, trail, type Shot } from "@/shared/steps";
import { enc } from "../common/api";
import { clock, kindOf, offset, size } from "../common/format";
import { useNow } from "../common/kit";
import { Desktop } from "./Desktop";

export interface ScreenProps {
  coworker: CoworkerView;
  thread: ThreadView;
  jobs: JobView[];
  /** The live stream's work, by turn. */
  work: Map<string, Work>;
  idleDeadline?: string;
  controlBusy: boolean;
  onControl: (action: "take" | "release") => void;
  onStart: () => Promise<unknown>;
}

const WORKING = new Set(["queued", "starting", "running", "canceling"]);
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;
/** Files the browser shows in place: the rest are downloads. */
const SHOWN = /\.(pdf|txt|md|csv|json|png|jpe?g|gif|webp)$/i;

/** A file the job made, as the trail shows it. */
interface Made {
  id: string;
  path: string;
  size: number;
  url: string;
}

/** The latest job in the thread, with the replies that carried it on: what the trail covers. */
function latestJob(jobs: JobView[]): JobView[] {
  return jobs.slice(Math.max(0, jobs.findLastIndex((job) => job.kind === "run")));
}

/** What the thread's latest job left: its screens, from its record once it has one and from the live stream until then, and its files. */
function useTrail(jobs: JobView[], work: Map<string, Work>): { shots: Shot[]; made: Made[]; startedAt: number } {
  return useMemo(() => {
    const chain = latestJob(jobs);
    const startedAt = chain.length ? Date.parse(chain[0].askedAt) : 0;
    const shots = chain.flatMap((job) =>
      trail(job.items ?? (job.turnId ? work.get(job.turnId)?.items : undefined) ?? []).map((shot) => ({
        ...shot,
        id: `${job.id}:${shot.id}`,
        // A recorded job names its saved pictures; the live stream carries them whole.
        src: shot.src.startsWith("data:") ? shot.src : `/api/jobs/${enc(job.id)}/shots/${enc(shot.src)}`,
      })),
    );
    const made = chain.flatMap((job) =>
      (job.files ?? []).map((file) => ({ id: `${job.id}:file:${file.path}`, path: file.path, size: file.size, url: `/api/jobs/${enc(job.id)}/files/${file.path.split("/").map(enc).join("/")}` })),
    );
    return { shots, made, startedAt };
  }, [jobs, work]);
}

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function Screen({ coworker, thread, jobs, work, idleDeadline, controlBusy, onControl, onStart }: ScreenProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const onProblem = useCallback((text: string | null) => setProblem(text), []);
  const [viewing, setViewing] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  // Until the live desktop has connected, the last screen stands in for it.
  const [connected, setConnected] = useState(false);
  const onConnected = useCallback(() => setConnected(true), []);
  useEffect(() => setConnected(false), [thread.stream]);
  const now = useNow();
  const { shots, made, startedAt } = useTrail(jobs, work);

  const last = jobs.at(-1);
  const driving = thread.status === "yours";
  const live = Boolean(thread.stream);
  const state = coworker.computer;
  const working = last !== undefined && WORKING.has(last.state);
  // A job that is queued, or whose Computer is still starting, has no session to show yet.
  const pending = !live && working;
  const left = idleDeadline ? Math.ceil((Date.parse(idleDeadline) - now) / 1000) : null;
  const liveItems = last?.turnId ? work.get(last.turnId)?.items : undefined;
  const jobStart = (last?.turnId ? work.get(last.turnId)?.startedAt : undefined) ?? (last ? Date.parse(last.askedAt) : now);

  const shot = viewing ? shots.find((s) => s.id === viewing) : undefined;
  const file = viewing ? made.find((f) => f.id === viewing) : undefined;
  const looking = Boolean(shot || file);
  const lastShot = shots.at(-1);
  useEffect(() => setViewing(null), [thread.id]);

  // Keep the newest screen in view as the trail grows, unless the person is looking back.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewing && working) strip.current?.scrollTo({ top: strip.current.scrollHeight, behavior: "smooth" });
  }, [shots.length, viewing, working]);

  const measure = (image: HTMLImageElement) => {
    if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
  };
  const back = live ? "Back to live" : "Back to the last screen";
  const left0 = [shots.length ? count(shots.length, "screen") : "", made.length ? count(made.length, "file") : ""].filter(Boolean).join(" and ");

  return (
    <div className="stage" style={ratio ? ({ "--shot-ratio": ratio.toFixed(4) } as CSSProperties) : undefined}>
      <div className="stage-in">
        <div className="monitor" data-driver={driving ? "human" : undefined}>
          <header className="monitor-bar">
            <div className="now" role="status">
              {driving ? (
                <>
                  <i className="dot" data-status="yours" />
                  <span>
                    You have the controls{" "}
                    <small>
                      · {coworker.name} waits{left !== null && left > 0 ? ` and takes over again in ${offset(left * 1000)} if you're idle` : ""}
                    </small>
                  </span>
                </>
              ) : pending ? (
                <>
                  <i className="dot" data-status="working" />
                  <span>{state === "starting" ? `Starting ${coworker.name}'s computer` : "Waiting to start"}</span>
                </>
              ) : live && working ? (
                <>
                  <i className="dot" data-status="working" />
                  <span>{(liveItems && doing(liveItems)) ?? "Working"}</span>
                  <time>{offset(now - jobStart)}</time>
                </>
              ) : thread.status === "asking" ? (
                <>
                  <i className="dot" data-status="asking" />
                  <span>Waiting for your answer</span>
                </>
              ) : (
                <>
                  <i className="dot" />
                  <span>
                    {live ? "Idle" : state === "stopped" ? "Stopped" : state === "none" ? "No computer yet" : state === "running" ? "Session ended" : state[0].toUpperCase() + state.slice(1)}
                    {last?.endedAt ? <small> · last job ended {clock(Date.parse(last.endedAt))}</small> : null}
                  </span>
                </>
              )}
            </div>
            <div className="end">
              {state === "running" && !driving ? <span className="machine">Computer running{coworker.expiresAt ? ` · stops itself at ${clock(Date.parse(coworker.expiresAt))} if idle` : ""}</span> : null}
              {looking ? (
                <button className="btn sm primary" onClick={() => setViewing(null)}>
                  <ArrowLeft /> {back}
                </button>
              ) : live ? (
                <button
                  className={`btn sm ${driving ? "human" : ""}`}
                  aria-busy={controlBusy}
                  disabled={controlBusy || (!driving && coworker.driving !== undefined)}
                  title={!driving && coworker.driving ? "You're driving another of its threads: hand that back first" : undefined}
                  onClick={() => onControl(driving ? "release" : "take")}
                >
                  <Hand /> {driving ? "Hand back" : "Take control"}
                </button>
              ) : null}
            </div>
          </header>
          <div className="frame">
            {live ? <Desktop thread={thread.id} stream={thread.stream!} driving={driving && !looking} onProblem={onProblem} onConnected={onConnected} /> : null}
            {live && !connected && !looking ? (
              lastShot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="last" src={lastShot.src} alt="" />
              ) : (
                <div className="veil blank">
                  <span className="state">
                    <i className="dot" data-status="working" />
                    Connecting
                  </span>
                </div>
              )
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!live && lastShot && !looking ? <img className="last" src={lastShot.src} alt="" onLoad={(event) => measure(event.currentTarget)} /> : null}
            {!live && !looking ? (
              <div className={`veil ${lastShot ? "" : "blank"}`}>
                <span className="state">
                  <i className="dot" data-status={state === "starting" || pending ? "working" : undefined} />
                  {state === "starting" ? "Starting" : pending ? "Waiting" : state === "running" ? "Session ended" : state === "none" ? "No computer yet" : state === "stopping" ? "Stopping" : "Stopped"}
                </span>
                <h2>
                  {state === "starting"
                    ? `Starting ${coworker.name}'s computer`
                    : pending
                      ? `Waiting for ${coworker.name}'s computer`
                      : state === "running"
                        ? "This thread is closed on its computer"
                        : state === "none"
                          ? `${coworker.name} has no computer yet`
                          : `${coworker.name}'s computer is stopped`}
                </h2>
                <p>
                  {state === "starting" || pending
                    ? "The screen appears here when the job starts."
                    : state === "none"
                      ? "Its first job creates one."
                      : state === "running"
                        ? "The next message here opens it again. Answers, files and the trail are kept."
                        : lastShot
                          ? "This is the last screen it left. Its sign-ins and skills are saved, and a message here starts it again."
                          : "Its sign-ins and skills are saved, and a message here starts it again."}
                </p>
                {state === "stopped" && !pending ? (
                  <button
                    className="btn primary"
                    aria-busy={starting}
                    disabled={starting}
                    onClick={async () => {
                      setStarting(true);
                      await onStart();
                      setStarting(false);
                    }}
                  >
                    <Play /> Start
                  </button>
                ) : null}
              </div>
            ) : null}
            {shot ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.src} alt={shot.caption} onLoad={(event) => measure(event.currentTarget)} />
                <div className="viewing">
                  <span>
                    Screen {shots.indexOf(shot) + 1} of {shots.length} · {shot.caption}
                  </span>
                  <time>{offset(shot.at - startedAt)}</time>
                </div>
              </>
            ) : null}
            {file ? (
              PICTURE.test(file.path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${file.url}?open`} alt={file.path} />
              ) : (
                <iframe className="paper" src={`${file.url}?open#view=FitH&toolbar=0`} title={file.path} />
              )
            ) : null}
          </div>
        </div>
        {problem && live ? (
          <p className="problem" style={{ marginTop: 10 }}>
            {problem}
          </p>
        ) : null}
      </div>

      <section className="trail" aria-label="The trail: what this job left">
        <div className="trail-in trail-head">
          <span className="label">Trail</span>
          {left0 ? <span className="count">{left0} this job left</span> : null}
          {left0 ? <span className="end">{looking ? "" : "Open one to look back"}</span> : null}
        </div>
        <div className="trail-scroll" ref={strip}>
          <div className="trail-in">
            {shots.length || made.length ? (
              <ol className="shots">
                {shots.map((s, i) => (
                  <li key={s.id}>
                    <button className="shot" aria-pressed={s.id === viewing} onClick={() => setViewing(s.id === viewing ? null : s.id)}>
                      <span className="pic">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.src} alt="" loading="lazy" onLoad={i === 0 ? (event) => measure(event.currentTarget) : undefined} />
                      </span>
                      <span className="cap">
                        <i>{String(i + 1).padStart(2, "0")}</i>
                        <span title={s.caption}>{s.caption}</span>
                        <time>{offset(s.at - startedAt)}</time>
                      </span>
                    </button>
                  </li>
                ))}
                {made.map((f) => {
                  const inside = (
                    <>
                      <span className="pic made">
                        {PICTURE.test(f.path) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${f.url}?open`} alt="" loading="lazy" />
                        ) : (
                          <span className="sheet">
                            <b>{kindOf(f.path)}</b>
                          </span>
                        )}
                      </span>
                      <span className="cap">
                        <i>File</i>
                        <span title={f.path}>{f.path}</span>
                        <time>{size(f.size)}</time>
                      </span>
                    </>
                  );
                  return (
                    <li key={f.id}>
                      {SHOWN.test(f.path) ? (
                        <button className="shot" aria-pressed={f.id === viewing} onClick={() => setViewing(f.id === viewing ? null : f.id)}>
                          {inside}
                        </button>
                      ) : (
                        <a className="shot" href={f.url} title={`Download ${f.path}`}>
                          {inside}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="trail-empty">{working ? "Each screen it leaves is kept here as it works." : "No screens yet. A job's screens are kept here, to look back at after its computer stops."}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
