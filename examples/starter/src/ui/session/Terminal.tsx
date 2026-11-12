"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Line = { kind: "cmd" | "out" | "err" | "exit"; text: string };

/**
 * The session's shell, beside the agent. Each command runs in the session's terminal
 * and its output streams back as it comes.
 */
export function Terminal({ session, label, onClose, autoFocus }: { session: string; label: string; onClose: () => void; autoFocus?: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [back, setBack] = useState(-1);
  const out = useRef<HTMLDivElement>(null);

  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [lines]);

  const run = async (text: string) => {
    setRunning(true);
    setHistory((all) => [text, ...all.filter((c) => c !== text)].slice(0, 50));
    setBack(-1);
    setLines((all) => [...all, { kind: "cmd", text }]);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session)}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "The command didn't run.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        rest += value;
        const parts = rest.split("\n");
        rest = parts.pop() ?? "";
        for (const part of parts) {
          if (!part) continue;
          const line = JSON.parse(part) as { type: string; text?: string; exitCode?: number | null; error?: string };
          if (line.type === "stdout") setLines((all) => [...all, { kind: "out", text: line.text ?? "" }]);
          else if (line.type === "stderr" || line.type === "error") setLines((all) => [...all, { kind: "err", text: line.text ?? "" }]);
          else if (line.type === "exit" && line.exitCode) setLines((all) => [...all, { kind: "exit", text: `exit ${line.exitCode}${line.error ? `: ${line.error}` : ""}` }]);
        }
      }
    } catch (error) {
      setLines((all) => [...all, { kind: "err", text: error instanceof Error ? error.message : "The command failed." }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="term" aria-label="Shell">
      <div className="term-head">
        Shell · {label}
        {running ? <span className="spinner" /> : null}
        <span className="end">
          <button className="btn ghost sm" onClick={() => setLines([])}>
            Clear
          </button>
          <button className="btn ghost icon sm" aria-label="Close the shell" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      <div className="term-out" ref={out}>
        {lines.length === 0 ? <span className="exit">Commands run in this session&apos;s shell and work directory, beside the agent.</span> : null}
        {lines.map((line, i) => (
          <div key={i} className={line.kind}>
            {line.text}
          </div>
        ))}
      </div>
      <form
        className="term-in"
        onSubmit={(event) => {
          event.preventDefault();
          const text = command.trim();
          if (!text || running) return;
          setCommand("");
          void run(text);
        }}
      >
        <input
          autoFocus={autoFocus}
          value={command}
          placeholder={running ? "Running…" : "ls -la"}
          spellCheck={false}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && history.length) {
              event.preventDefault();
              const next = Math.min(history.length - 1, back + 1);
              setBack(next);
              setCommand(history[next]);
            } else if (event.key === "ArrowDown" && back >= 0) {
              event.preventDefault();
              const next = back - 1;
              setBack(next);
              setCommand(next >= 0 ? history[next] : "");
            }
          }}
        />
      </form>
    </div>
  );
}
