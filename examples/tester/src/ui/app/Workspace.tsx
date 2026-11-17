"use client";

// The page's picture of the workspace, shared by every view: the Computer's state and
// the runs. It reads /api/workspace again whenever /api/live says something changed.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { brand } from "@/brand";
import { host, question, working, type RunView, type Workspace as WorkspaceState } from "@/shared/api";
import { call, errorText } from "../common/api";
import { clock } from "../common/format";
import { Logo } from "./Logo";
import { ThemeToggle } from "./Theme";

interface WorkspaceContext {
  ws: WorkspaceState;
  refresh: () => Promise<void>;
  /** Runs a call to this app's API; a failure is shown in the bar and resolves undefined. */
  act: <T>(run: () => Promise<T>) => Promise<T | undefined>;
}

const Context = createContext<WorkspaceContext | null>(null);

export function useWorkspace(): WorkspaceContext {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkspace outside Workspace");
  return value;
}

/** Reads the workspace, and again whenever the server says it changed. */
export function useWorkspaceState(onProblem?: (text: string | null) => void): { ws: WorkspaceState | null; refresh: () => Promise<void> } {
  const [ws, setWs] = useState<WorkspaceState | null>(null);
  const refresh = useCallback(async () => {
    try {
      setWs(await call<WorkspaceState>("/api/workspace"));
    } catch (error) {
      onProblem?.(errorText(error));
    }
  }, [onProblem]);

  // Read again when the server says so (batched), and now and then in case a push was missed.
  useEffect(() => {
    void refresh();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/live");
    source.onmessage = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void refresh(), 120);
    };
    const timer = setInterval(() => void refresh(), 20_000);
    return () => {
      source.close();
      clearInterval(timer);
      clearTimeout(pending);
    };
  }, [refresh]);
  return { ws, refresh };
}

const MACHINE: Record<WorkspaceState["computer"], string> = { none: "No computer yet", stopped: "Computer stopped", starting: "Computer starting", running: "Computer running", stopping: "Computer stopping" };

/** Where a run stands, in a word or two, for the band. */
function standing(run: RunView): { word: string; status?: string } {
  if (run.driving) return { word: "You have the controls", status: "asking" };
  if (working(run)) return { word: "Checking", status: "working" };
  if (run.state === "needs_input") return { word: question(run.question ?? "").approval ? "Approval needed" : "Your turn", status: "asking" };
  if (run.state === "completed") return { word: "Report" };
  return { word: run.state === "failed" ? "Did not finish" : "Stopped" };
}

export function Workspace({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState<string | null>(null);
  const { ws, refresh } = useWorkspaceState(setProblem);
  const path = usePathname();

  const act = useCallback(
    async <T,>(run: () => Promise<T>) => {
      try {
        const result = await run();
        setProblem(null);
        return result;
      } catch (error) {
        setProblem(errorText(error));
        return undefined;
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const value = useMemo(() => (ws ? { ws, refresh, act } : null), [ws, refresh, act]);
  if (!value || !ws) return null;
  const busy = ws.runs.some((run) => run.stream);
  const shown = ws.runs.find((run) => path === `/r/${run.id}`);
  const stands = shown ? standing(shown) : null;
  return (
    <Context.Provider value={value}>
      <div className="app">
        <header className="top">
          <Link href="/" className="logo" aria-label={`${brand.name}: all runs`}>
            <Logo />
            {brand.name}
          </Link>
          {shown && stands ? (
            <p className="band-run">
              <span>{host(shown.target)}</span>
              <b data-status={stands.status}>{stands.word}</b>
            </p>
          ) : null}
          {problem ? (
            <p className="top-problem" role="alert">
              {problem}
              <button className="btn ghost sm" onClick={() => setProblem(null)}>
                Dismiss
              </button>
            </p>
          ) : null}
          <div className="end">
            <span className="machine" data-state={ws.computer}>
              <i className="dot" data-status={ws.computer === "running" ? "ok" : ws.computer === "starting" ? "working" : undefined} />
              {MACHINE[ws.computer]}
              {ws.computer === "running" && ws.expiresAt && !busy ? <small> · stops itself at {clock(Date.parse(ws.expiresAt))} if idle</small> : null}
            </span>
            {ws.computer === "running" && !busy ? (
              <button className="btn sm" onClick={() => void act(() => call("/api/computer", { body: { action: "stop" } }))}>
                Stop
              </button>
            ) : null}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>
    </Context.Provider>
  );
}
