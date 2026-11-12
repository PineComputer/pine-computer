"use client";

import { Check, Copy, Pause, Play, Power, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import type { ComputerView } from "@/shared/api";
import { useApp, type Lifecycle } from "../app/AppProvider";
import { STATE_WORDS, stateTone } from "../app/Shell";
import { countdown, duration, relative } from "../common/format";
import { countryName, flag, useNow } from "../common/kit";

const BUSY_STATE: Partial<Record<Lifecycle, string>> = {
  start: "starting",
  recover: "starting",
  stop: "stopping",
  pause: "pausing",
  resume: "resuming",
};

const SUBLINE: Record<string, string> = {
  running: "Its browser, shell and agents are up.",
  stopped: "Nothing is running. Its sign-ins, cookies and skills are saved for the next Start.",
  paused: "Everything is held in memory, open pages and sessions included.",
  failed: "The sandbox failed. Recover releases it and starts again from the last saved state.",
};

export function SandboxCard({ computer }: { computer: ComputerView }) {
  const { busy, lifecycle } = useApp();
  const now = useNow();
  const state = (busy && BUSY_STATE[busy]) || computer.state;
  const tone = stateTone(state) ?? "none";
  const idle = computer.lifetime?.idleTimeoutSeconds ?? computer.idleTimeoutSeconds ?? 300;
  const left = state === "running" && computer.expiresAt ? Date.parse(computer.expiresAt) - now : null;
  const lifetime = computer.lifetime;

  return (
    <section className="card cv-sandbox" aria-label="Sandbox">
      <div className="cv-sandbox-top" data-tone={tone}>
        <div className="cv-state">
          <div className="cv-state-word">
            <span className="dot" data-tone={tone === "none" ? undefined : tone} />
            {STATE_WORDS[state] ?? state}
          </div>
          <p className="cv-state-sub">{SUBLINE[state] ?? "Changing state…"}</p>
          {left !== null && left > 0 ? (
            <div className="cv-life">
              <span>Sleeps in {countdown(left)} unless something uses it</span>
              <div className="meter">
                <i style={{ width: `${Math.min(100, (left / (idle * 1000)) * 100)}%` }} />
              </div>
            </div>
          ) : null}
        </div>
        <div className="cv-actions">
          {state === "running" ? (
            <>
              {computer.canPause ? (
                <button className="btn" disabled={busy !== null} onClick={() => void lifecycle("pause")}>
                  <Pause /> Pause
                </button>
              ) : null}
              <button className="btn" disabled={busy !== null} onClick={() => void lifecycle("stop")}>
                <Power /> Stop
              </button>
            </>
          ) : state === "paused" ? (
            <>
              <button className="btn primary" disabled={busy !== null} onClick={() => void lifecycle("resume")}>
                <Play /> Resume
              </button>
              <button className="btn" disabled={busy !== null} onClick={() => void lifecycle("stop")}>
                <Power /> Stop
              </button>
            </>
          ) : state === "failed" ? (
            <button className="btn primary" aria-busy={busy === "recover"} disabled={busy !== null} onClick={() => void lifecycle("recover")}>
              <RotateCcw /> Recover
            </button>
          ) : state === "stopped" ? (
            <button className="btn primary" disabled={busy !== null} onClick={() => void lifecycle("start")}>
              <Play /> Start
            </button>
          ) : (
            <button className="btn" disabled aria-busy>
              Working
            </button>
          )}
        </div>
      </div>

      {computer.problem && state === "failed" ? (
        <p className="problem cv-problem" style={{ marginTop: 16 }}>
          {computer.problem} Recovering loses anything it hadn&apos;t saved yet.
        </p>
      ) : null}

      <dl className="cv-facts">
        <Fact label="Computer">
          <span className="mono" title={computer.id}>
            {computer.id}
          </span>
          <CopyButton text={computer.id} />
        </Fact>
        <Fact label="Sandbox">
          <span className="mono" title={computer.sandboxId}>
            {computer.sandboxId ?? "None while stopped"}
          </span>
        </Fact>
        <Fact label="Started">{computer.createdAt ? relative(Date.parse(computer.createdAt), now) : "—"}</Fact>
        <Fact label="Browses from">
          {flag(computer.location)} {countryName(computer.location)}
        </Fact>
        <Fact label="Idle timeout">{duration(idle * 1000)}</Fact>
        <Fact label="Maximum age">
          {lifetime ? (
            <>
              {duration(lifetime.maxRuntimeAgeSeconds * 1000)}
              {lifetime.deadline ? <span className="muted">· ends {relative(Date.parse(lifetime.deadline), now)}</span> : null}
            </>
          ) : (
            "—"
          )}
        </Fact>
      </dl>

      <div className="cv-notes">
        <p className="cv-note">
          <Pause />
          <span>
            <b>Pause</b> keeps memory, open pages and sessions exactly as they are, and Resume picks up there.{" "}
            {computer.canPause ? "It needs your project's Pause/Resume feature." : "Your project doesn't have Pause/Resume turned on."}
          </span>
        </p>
        <p className="cv-note">
          <Save />
          <span>
            <b>Stop</b> saves sign-ins, cookies and learned skills, then frees the compute. <b>Start</b> restores them into a fresh sandbox.
          </span>
        </p>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cv-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost icon sm copy"
      aria-label="Copy the Computer's id"
      title="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check style={{ color: "var(--ok)" }} /> : <Copy />}
    </button>
  );
}
