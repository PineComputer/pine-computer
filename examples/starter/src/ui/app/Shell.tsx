"use client";

import { Clock3, FolderOpen, KeyRound, Monitor, Plus, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { brand } from "@/brand";
import type { ComputerView, SessionView } from "@/shared/api";
import { call, errorText } from "../common/api";
import { countryName, flag, useNow } from "../common/kit";
import { countdown } from "../common/format";
import { AppProvider, useApp } from "./AppProvider";
import { Logo } from "./Logo";
import { Palette } from "./Palette";
import { ThemeToggle } from "./Theme";
import { Toasts } from "./Toasts";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <div className="shell">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <Palette />
      <Toasts />
    </AppProvider>
  );
}

const NAV = [
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/schedules", label: "Schedules", icon: Clock3 },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/vault", label: "Vault", icon: KeyRound },
  { href: "/computer", label: "Computer", icon: Monitor },
];

function Sidebar() {
  const { app, setPalette, toast, refresh } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const running = app?.computer?.state === "running";
  const open = app?.sessions.filter((s) => s.open).length ?? 0;

  const addSession = async () => {
    setAdding(true);
    try {
      const { name } = await call<{ name: string }>("/api/sessions", { body: { label: `Session ${(app?.sessions.length ?? 0) + 1}` } });
      await refresh();
      router.push(`/s/${name}`);
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setAdding(false);
    }
  };

  return (
    <aside className="side">
      <div className="side-top">
        <Link href="/" className="logo">
          <Logo />
          {brand.name}
        </Link>
        <button className="jump" onClick={() => setPalette(true)}>
          <Search />
          Jump to…
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="side-scroll">
        {app?.computer ? (
          <nav className="side-group" aria-label="Sessions">
            <div className="side-label">
              Sessions
              <button
                className="btn ghost icon sm"
                aria-label="New session"
                title={running ? (open >= (app?.sessionLimit ?? 3) ? `Up to ${app?.sessionLimit} at once` : "New session") : "Start the Computer first"}
                aria-busy={adding}
                disabled={!running || adding || open >= (app?.sessionLimit ?? 3)}
                onClick={() => void addSession()}
              >
                <Plus />
              </button>
            </div>
            {app.sessions.map((s) => (
              <SessionLink key={s.name} session={s} current={path === `/s/${s.name}`} />
            ))}
          </nav>
        ) : null}

        <nav className="side-group" aria-label="Workspace">
          <div className="side-label">Workspace</div>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-item" aria-current={path.startsWith(href) ? "page" : undefined}>
              <Icon />
              <span className="label">{label}</span>
              {href === "/skills" && app?.drafts ? <span className="badge accent">{app.drafts} to review</span> : null}
            </Link>
          ))}
        </nav>
      </div>

      {app?.computer ? <Machine computer={app.computer} /> : null}
      <div className="side-foot">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function SessionLink({ session, current }: { session: SessionView; current: boolean }) {
  const tone = session.working ? "agent" : session.waiting ? "human" : undefined;
  return (
    <Link href={`/s/${session.name}`} className="nav-item" aria-current={current ? "page" : undefined}>
      <span className="glyph">
        <span className="dot" data-tone={tone} style={tone ? undefined : { background: session.open ? "var(--fg-3)" : "var(--fg-4)" }} />
      </span>
      <span className="label">{session.label}</span>
      {session.working ? <span className="meta">working</span> : session.waiting ? <span className="meta" style={{ color: "var(--human)" }}>needs you</span> : null}
    </Link>
  );
}

export const STATE_WORDS: Record<string, string> = {
  running: "Running",
  stopped: "Stopped",
  paused: "Paused",
  pausing: "Pausing",
  resuming: "Resuming",
  starting: "Starting",
  pending: "Starting",
  stopping: "Stopping",
  failed: "Needs recovery",
};

export const stateTone = (state: string) =>
  state === "running" ? "ok" : state === "paused" ? "paused" : state === "failed" ? "bad" : state === "stopped" ? undefined : "busy";

function Machine({ computer }: { computer: ComputerView }) {
  const { busy, lifecycle } = useApp();
  const now = useNow();
  const state = busy === "start" || busy === "recover" ? "starting" : busy === "stop" ? "stopping" : busy === "pause" ? "pausing" : busy === "resume" ? "resuming" : computer.state;
  const left = computer.expiresAt && state === "running" ? Date.parse(computer.expiresAt) - now : null;
  const idle = computer.lifetime?.idleTimeoutSeconds ?? computer.idleTimeoutSeconds ?? 300;

  return (
    <div className="machine">
      <div className="machine-top">
        <span className="dot" data-tone={stateTone(state)} />
        {STATE_WORDS[state] ?? state}
        <span className="where" title={countryName(computer.location)}>
          {flag(computer.location)} {computer.location === "direct" ? "Direct" : (computer.location ?? "").toUpperCase()}
        </span>
      </div>
      {left !== null && left > 0 ? (
        <div className="machine-life">
          <span>Sleeps in {countdown(left)} if idle</span>
          <div className="meter">
            <i style={{ width: `${Math.min(100, (left / (idle * 1000)) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="machine-actions">
        {state === "running" ? (
          <>
            {computer.canPause ? (
              <button className="btn sm" disabled={busy !== null} onClick={() => void lifecycle("pause")}>
                Pause
              </button>
            ) : null}
            <button className="btn sm" disabled={busy !== null} onClick={() => void lifecycle("stop")}>
              Stop
            </button>
          </>
        ) : state === "paused" ? (
          <>
            <button className="btn sm primary" disabled={busy !== null} onClick={() => void lifecycle("resume")}>
              Resume
            </button>
            <button className="btn sm" disabled={busy !== null} onClick={() => void lifecycle("stop")}>
              Stop
            </button>
          </>
        ) : state === "failed" ? (
          <button className="btn sm primary" aria-busy={busy === "recover"} disabled={busy !== null} onClick={() => void lifecycle("recover")}>
            Recover
          </button>
        ) : state === "stopped" ? (
          <button className="btn sm primary" disabled={busy !== null} onClick={() => void lifecycle("start")}>
            Start
          </button>
        ) : (
          <button className="btn sm" disabled aria-busy>
            Working
          </button>
        )}
      </div>
    </div>
  );
}
