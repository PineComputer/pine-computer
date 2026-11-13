"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { call, enc } from "../common/api";
import { Avatar } from "../common/kit";
import { useWorkspace } from "../app/Workspace";
import { Composer } from "../thread/Composer";
import { Profile } from "./Profile";

/** Starts a thread with a coworker; resolves to whether it did. */
export function useNewThread() {
  const { act } = useWorkspace();
  const router = useRouter();
  return async (coworker: string, goal: string) => {
    const opened = await act(() => call<{ thread: string }>(`/api/coworkers/${enc(coworker)}/threads`, { body: { goal, key: crypto.randomUUID() } }));
    if (opened) router.push(`/t/${opened.thread}`);
    return opened !== undefined;
  };
}

/** A coworker, with no thread open: a new thread on the left, its profile on the right. */
export function CoworkerView({ id }: { id: string }) {
  const { ws } = useWorkspace();
  const router = useRouter();
  const newThread = useNewThread();
  const [starting, setStarting] = useState(false);
  const coworker = ws.coworkers.find((c) => c.id === id);
  useEffect(() => {
    if (!coworker) router.replace("/");
  }, [coworker, router]);
  if (!coworker) return null;

  return (
    <main className="main">
      <section className="col" aria-label={`A new thread with ${coworker.name}`}>
        <header className="bar">
          <Avatar name={coworker.name} color={coworker.color} size="sm" />
          <h1>{coworker.name}</h1>
          <span className="sub">New thread</span>
        </header>
        <div className="log">
          <div className="log-in">
            <div className="intro">
              <h2>What should {coworker.name} do?</h2>
              <p>
                A message starts a thread: one job on {coworker.name}&apos;s own computer, and every follow-up builds on it. You can watch the screen, step in, and answer when it asks.
              </p>
              {coworker.suggestion ? (
                <div>
                  <button
                    className="try"
                    disabled={starting}
                    onClick={async () => {
                      setStarting(true);
                      await newThread(coworker.id, coworker.suggestion!);
                      setStarting(false);
                    }}
                  >
                    <ArrowRight /> {coworker.suggestion}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <Composer mode="job" name={coworker.name} onSend={(text) => newThread(coworker.id, text)} />
      </section>
      <section className="col" aria-label={`${coworker.name}'s profile`}>
        <header className="bar">
          <h1>Profile</h1>
        </header>
        <Profile coworker={coworker} />
      </section>
    </main>
  );
}
