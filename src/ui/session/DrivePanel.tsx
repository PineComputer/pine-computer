"use client";

import { Bot, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DriveStep } from "@/shared/api";

/**
 * Your own model at the controls of this session: say what to do, and watch each step
 * it takes on the screen above. Pine's agent isn't involved.
 */
export function DrivePanel({ session, label, available, onClose }: { session: string; label: string; available: boolean; onClose: () => void }) {
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<DriveStep[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const out = useRef<HTMLDivElement>(null);

  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [steps]);
  useEffect(() => () => stop.current?.abort(), []);

  const run = async (text: string) => {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setSteps([{ type: "said", text: `▸ ${text}` }]);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session)}/drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "It didn't start.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        rest += value;
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) if (line) setSteps((all) => [...all, JSON.parse(line) as DriveStep]);
      }
    } catch (error) {
      if (!controller.signal.aborted) setSteps((all) => [...all, { type: "error", text: error instanceof Error ? error.message : "It stopped." }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="term drive" aria-label="Your agent">
      <div className="term-head">
        <Bot size={14} /> Your agent · drives {label} through the drive API
        {running ? <span className="spinner" /> : null}
        <span className="end">
          {running ? (
            <button className="btn ghost sm" onClick={() => stop.current?.abort()}>
              <Square fill="currentColor" size={10} /> Stop
            </button>
          ) : null}
          <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      <div className="term-out" ref={out}>
        {!available ? (
          <span className="exit">
            Set ANTHROPIC_API_KEY on the server, and Claude drives this session: it sees each screenshot and the Computer carries out its clicks and keys.
          </span>
        ) : steps.length === 0 ? (
          <span className="exit">Your model decides every step; the Computer is its hands and eyes. Take the controls back whenever you like.</span>
        ) : null}
        {steps.map((step, i) =>
          step.type === "screen" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from the stream
            <img key={i} className="drive-shot" src={step.src} alt="The screen after that step" />
          ) : (
            <div key={i} className={step.type === "error" ? "err" : step.type === "action" ? "cmd" : step.type === "done" ? "exit" : undefined}>
              {step.type === "done" ? (step.text ?? "Done.") : step.text}
            </div>
          ),
        )}
      </div>
      <form
        className="term-in"
        onSubmit={(event) => {
          event.preventDefault();
          const text = goal.trim();
          if (!text || running || !available) return;
          setGoal("");
          void run(text);
        }}
      >
        <input value={goal} disabled={!available || running} placeholder={available ? "What should your model do on this screen?" : "ANTHROPIC_API_KEY isn't set"} onChange={(event) => setGoal(event.target.value)} />
      </form>
    </div>
  );
}
