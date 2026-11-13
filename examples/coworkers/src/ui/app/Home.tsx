"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { brand } from "@/brand";
import type { CoworkerView } from "@/shared/api";
import { ago, cost, duration } from "../common/format";
import { Avatar } from "../common/kit";
import { useNewThread } from "../coworker/CoworkerView";
import { useWorkspace } from "./Workspace";

const WORDS: Record<string, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Working",
  canceling: "Stopping",
  needs_input: "Waiting for you",
  answered: "Working",
  completed: "Done",
  failed: "Didn't finish",
  canceled: "Stopped",
  stopped: "Its computer stopped",
};
const MACHINE = { none: "No computer yet", stopped: "Computer stopped", starting: "Computer starting", running: "Computer running", stopping: "Computer stopping" };

/** A coworker's Computer and what it has learned, in one quiet line. */
export function MachineLine({ coworker }: { coworker: CoworkerView }) {
  const state = coworker.computer;
  const skills = coworker.skills.length;
  return (
    <p className="machine">
      <i className="dot" data-status={state === "running" ? "ok" : state === "starting" || state === "stopping" ? "working" : "idle"} />
      <b>{MACHINE[state]}</b>
      {skills ? <span>· {skills === 1 ? "1 skill" : `${skills} skills`}</span> : state === "none" ? <span>· its first job creates one</span> : null}
    </p>
  );
}

/** The team, and a first job to hand each of them. */
export function Home() {
  const { ws } = useWorkspace();
  const newThread = useNewThread();
  const [starting, setStarting] = useState<string | null>(null);
  const running = ws.coworkers.filter((c) => c.computer === "running").length;
  // The team's latest jobs, newest first, each under its thread's name.
  const lately = ws.jobs
    .filter((job) => job.kind === "run")
    .slice(-6)
    .reverse()
    .flatMap((job) => {
      const coworker = ws.coworkers.find((c) => c.id === job.coworker);
      const thread = ws.threads.find((t) => t.id === job.thread);
      // A reply carries a job on: how it stands is how its latest turn stands.
      const latest = ws.jobs.findLast((j) => j.thread === job.thread) ?? job;
      return coworker && thread ? [{ job: { ...job, state: latest.state }, coworker, thread }] : [];
    });
  return (
    <main className="main" data-panel="closed">
      <section className="col" aria-label="Your team">
        <header className="bar">
          <h1>Team</h1>
          <span className="sub">
            {ws.coworkers.length} coworkers · {running === 0 ? "no computer running" : running === 1 ? "1 computer running" : `${running} computers running`}
          </span>
        </header>
        <div className="home">
          <div className="home-in">
            <div className="home-head">
              <h2>{brand.tagline}</h2>
              <p>Each one works in its own computer, with its own sign-ins, files and skills. Hand one a job and watch it work, step in when you like, and answer when it asks.</p>
            </div>
            <ul className="team">
              {ws.coworkers.map((coworker) => (
                <li key={coworker.id}>
                  <div className="id">
                    <Avatar name={coworker.name} color={coworker.color} status={coworker.status} size="lg" />
                    <div>
                      <h3>
                        <Link href={`/c/${coworker.id}`}>{coworker.name}</Link>
                      </h3>
                      <p className="role">{coworker.role}</p>
                    </div>
                  </div>
                  <p className="brief">{coworker.brief}</p>
                  <MachineLine coworker={coworker} />
                  {coworker.suggestion ? (
                    <button
                      className="try"
                      disabled={starting !== null}
                      onClick={async () => {
                        setStarting(coworker.id);
                        await newThread(coworker.id, coworker.suggestion!);
                        setStarting(null);
                      }}
                    >
                      <span>
                        <small>A first job</small>
                        {coworker.suggestion}
                      </span>
                      <span className="go">
                        <ArrowRight />
                      </span>
                    </button>
                  ) : (
                    <Link className="btn" href={`/c/${coworker.id}`} style={{ justifySelf: "start" }}>
                      Give {coworker.name} a job
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {lately.length ? (
              <div className="lately">
                <span className="label">Lately</span>
                <ul className="table">
                  {lately.map(({ job, coworker, thread }) => (
                    <li key={job.id}>
                      <Avatar name={coworker.name} color={coworker.color} size="sm" />
                      <Link className="t" href={`/t/${job.thread}`} title={job.ask}>
                        {thread.title}
                      </Link>
                      <span className="who">{WORDS[job.state] ?? job.state}</span>
                      <span className="n">{ago(Date.parse(job.askedAt))}</span>
                      <span className="n">{job.durationMs ? duration(job.durationMs) : ""}</span>
                      <span className="n">{cost(job.cost) ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
