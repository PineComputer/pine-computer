"use client";

import { Bot, Globe, Hand, MonitorOff, Play, SquareTerminal, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { brand } from "@/brand";
import type { TabView } from "@/shared/api";
import { call, errorText } from "../common/api";
import { useNow } from "../common/kit";
import { countdown, hostOf } from "../common/format";
import { useApp } from "../app/AppProvider";
import { Desktop } from "./Desktop";

// A blank tab (about:blank, with Pine's session marker) is a new tab to a person.
const tabTitle = (tab: TabView) => (tab.url.startsWith("about:") ? "New tab" : tab.title || hostOf(tab.url));

export interface StageProps {
  session: string;
  /** Changes as the agent acts: the tabs are read again. */
  pulse: number;
  /** The session's stream key while it's open; null while the Computer can't show it. */
  stream: string | null;
  state: string;
  working: boolean;
  driving: boolean;
  /** Another session has the person at its controls: one at a time per Computer. */
  drivenElsewhere: boolean;
  idleDeadline?: string;
  controlBusy: boolean;
  onControl: (action: "take" | "release") => void;
  /** The panel open under the screen: the session's shell, or your own agent. */
  panel: "shell" | "agent" | null;
  onPanel: (panel: "shell" | "agent" | null) => void;
  peek: { src: string; title: string } | null;
  onPeekClose: () => void;
  children?: React.ReactNode;
}

/** The Computer's screen in a browser frame: its tabs, who drives, and the shell below. */
export const Stage = forwardRef<HTMLInputElement, StageProps>(function Stage(props, urlRef) {
  const { session, pulse, stream, state, working, driving, drivenElsewhere, idleDeadline, controlBusy, onControl, panel, onPanel, peek, onPeekClose, children } = props;
  const { lifecycle, busy, toast } = useApp();
  const [tabs, setTabs] = useState<TabView[]>([]);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow();
  const onProblem = useCallback((text: string | null) => setProblem(text), []);

  const loadTabs = useCallback(async () => {
    if (!stream) return setTabs([]);
    try {
      setTabs(await call<TabView[]>(`/api/sessions/${encodeURIComponent(session)}/tabs`));
    } catch {
      // the tabs come back on the next look
    }
  }, [session, stream]);

  // The agent opens and closes tabs as it works: look again as it acts, and now and then.
  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && void loadTabs(), 5000);
    return () => clearInterval(timer);
  }, [loadTabs]);
  // As the agent acts, at most once a moment (events stream faster than that), and again
  // once the page it opened has its title. A new event never puts a look off.
  const looking = useRef(false);
  useEffect(() => {
    if (looking.current) return;
    looking.current = true;
    setTimeout(() => void loadTabs(), 600);
    setTimeout(() => {
      looking.current = false;
      void loadTabs();
    }, 2500);
  }, [loadTabs, pulse]);

  const tabAction = async (tab: TabView, action: "focus" | "close") => {
    try {
      await call(`/api/sessions/${encodeURIComponent(session)}/tabs/${encodeURIComponent(tab.id)}`, { method: action === "focus" ? "PATCH" : "DELETE" });
      await loadTabs();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    }
  };

  const openUrl = async () => {
    const address = url.trim();
    if (!address) return;
    try {
      await call(`/api/sessions/${encodeURIComponent(session)}/tabs`, { body: { url: address } });
      setUrl("");
      await loadTabs();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    }
  };

  const driver = driving ? "human" : working ? "agent" : undefined;
  const left = idleDeadline ? Date.parse(idleDeadline) - now : null;

  return (
    <section className="stage" aria-label="The Computer's screen">
      <div className="stage-bar">
        <div className="tabs" role="tablist" aria-label="Browser tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              className="tab"
              aria-selected={tab.active}
              title={tab.url}
              ref={(el) => {
                if (tab.active) el?.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              onClick={() => !tab.active && void tabAction(tab, "focus")}
            >
              <span className="fav">{(hostOf(tab.url)[0] ?? "·").toUpperCase()}</span>
              <span className="t">{tabTitle(tab)}</span>
              {tabs.length > 1 ? (
                <span
                  className="x"
                  role="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void tabAction(tab, "close");
                  }}
                >
                  <X size={12} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {stream ? (
          <form
            className="url-form"
            onSubmit={(event) => {
              event.preventDefault();
              void openUrl();
            }}
          >
            <Globe />
            <input ref={urlRef} value={url} placeholder="Open a page in a new tab" onChange={(event) => setUrl(event.target.value)} />
          </form>
        ) : null}
        {stream ? (
          <>
            <button className={`btn sm icon ${panel === "agent" ? "" : "ghost"}`} aria-pressed={panel === "agent"} title="Drive with your own model" aria-label="Your agent" onClick={() => onPanel(panel === "agent" ? null : "agent")}>
              <Bot />
            </button>
            <button className={`btn sm icon ${panel === "shell" ? "" : "ghost"}`} aria-pressed={panel === "shell"} title="Shell" aria-label="Toggle the shell" onClick={() => onPanel(panel === "shell" ? null : "shell")}>
              <SquareTerminal />
            </button>
            <button
              className={`btn sm ${driving ? "human" : ""}`}
              aria-busy={controlBusy}
              disabled={controlBusy || (!driving && drivenElsewhere)}
              title={drivenElsewhere && !driving ? "You're driving another session: hand that back first" : undefined}
              onClick={() => onControl(driving ? "release" : "take")}
            >
              <Hand />
              {driving ? "Hand back" : "Take the controls"}
            </button>
          </>
        ) : null}
      </div>

      <div className="screen" data-driver={driver}>
        {stream ? (
          <div className="frame">
            <div className="inner">
              <Desktop session={session} stream={stream} driving={driving} onProblem={onProblem} />
            </div>
          </div>
        ) : (
          <div className="screen-msg">
            <span className="ring">
              <MonitorOff />
            </span>
            <h2>{state === "paused" ? "Paused, with everything in memory" : state === "stopped" ? "The Computer is stopped" : state === "failed" ? "The Computer needs recovering" : "Starting…"}</h2>
            <p>
              {state === "paused"
                ? "Resume to pick up exactly where it was: the same pages, the same session."
                : state === "stopped"
                  ? "Start restores its sign-ins, cookies and skills into a fresh sandbox. The answers and files on the left are kept by this app."
                  : state === "failed"
                    ? "Recover starts it again from its saved state."
                    : ""}
            </p>
            {state === "stopped" || state === "paused" || state === "failed" ? (
              <button
                className="btn primary"
                aria-busy={busy !== null}
                disabled={busy !== null}
                onClick={() => void lifecycle(state === "paused" ? "resume" : state === "failed" ? "recover" : "start")}
              >
                <Play /> {state === "paused" ? "Resume" : state === "failed" ? "Recover" : "Start"}
              </button>
            ) : null}
          </div>
        )}
        {driving ? (
          <div className="banner" role="status">
            <span className="dot" data-tone="human" />
            You&apos;re driving. {brand.agent} waits{left !== null && left > 0 ? `; it takes back over in ${countdown(left)} if you're idle` : ""}.
            <button className="btn sm human" onClick={() => onControl("release")}>
              Hand back
            </button>
          </div>
        ) : null}
        {problem && stream ? (
          <div className="banner" role="alert">
            <span className="dot" data-tone="bad" />
            {problem}
          </div>
        ) : null}
        {peek ? (
          <div className="peek" role="dialog" aria-label={`The screen after ${peek.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the stream */}
            <img src={peek.src} alt={`The screen after ${peek.title}`} />
            <button className="btn sm" onClick={onPeekClose}>
              Back to live
            </button>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
});
