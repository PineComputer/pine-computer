"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { brand } from "@/brand";
import { Avatar } from "../common/kit";
import { useNewThread } from "../coworker/CoworkerView";
import { useWorkspace } from "./Workspace";

/** The team, and a first job to hand each of them. */
export function Home() {
  const { ws } = useWorkspace();
  const newThread = useNewThread();
  const [starting, setStarting] = useState<string | null>(null);
  return (
    <main className="main" data-panel="closed">
      <section className="col" aria-label="Your team">
        <header className="bar">
          <h1>Your team</h1>
          <span className="sub">
            {ws.coworkers.length} coworkers, {ws.coworkers.filter((c) => c.computer === "running").length} with a computer running
          </span>
        </header>
        <div className="log">
          <div className="log-in">
            <div className="intro">
              <h2>{brand.tagline}</h2>
              <p>Each one works in its own computer, with its own sign-ins, files and skills. Hand one a job and watch it work, step in when you like, and answer when it asks.</p>
            </div>
            <ul className="team">
              {ws.coworkers.map((coworker) => (
                <li key={coworker.id}>
                  <Avatar name={coworker.name} color={coworker.color} status={coworker.status} size="lg" />
                  <h3>
                    <Link href={`/c/${coworker.id}`}>{coworker.name}</Link>
                    <span>{coworker.role}</span>
                  </h3>
                  <p>{coworker.brief}</p>
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
                      <ArrowRight /> {coworker.suggestion}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
