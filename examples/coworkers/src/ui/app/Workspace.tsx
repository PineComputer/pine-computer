"use client";

// The page's picture of the workspace, shared by every view. It reads /api/workspace
// again whenever /api/live says something changed, and turns what the server pushes (a
// finished job, a question) into notices.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LiveEvent, Workspace as WorkspaceState } from "@/shared/api";
import { call, errorText } from "../common/api";
import { Sidebar } from "./Sidebar";

interface Notice {
  id: number;
  tone: "info" | "done" | "failed";
  text: string;
  href?: string;
}

interface WorkspaceContext {
  ws: WorkspaceState;
  refresh: () => Promise<void>;
  notify: (notice: Omit<Notice, "id">) => void;
  /** Runs a call to this app's API; a failure becomes a notice and resolves undefined. */
  act: <T>(run: () => Promise<T>) => Promise<T | undefined>;
}

const Context = createContext<WorkspaceContext | null>(null);

export function useWorkspace(): WorkspaceContext {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkspace outside Workspace");
  return value;
}

export function Workspace({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<WorkspaceState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const counter = useRef(0);

  const notify = useCallback((notice: Omit<Notice, "id">) => {
    const id = (counter.current += 1);
    setNotices((all) => [...all.slice(-2), { ...notice, id }]);
    setTimeout(() => setNotices((all) => all.filter((n) => n.id !== id)), notice.tone === "failed" ? 9000 : 5000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setWs(await call<WorkspaceState>("/api/workspace"));
    } catch (error) {
      notify({ tone: "failed", text: errorText(error) });
    }
  }, [notify]);

  const act = useCallback(
    async <T,>(run: () => Promise<T>) => {
      try {
        return await run();
      } catch (error) {
        notify({ tone: "failed", text: errorText(error) });
        return undefined;
      } finally {
        void refresh();
      }
    },
    [notify, refresh],
  );

  // Read again when the server says so (batched), and now and then in case a push was missed.
  useEffect(() => {
    void refresh();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/live");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      if (event.type === "notice") return notify(event);
      clearTimeout(pending);
      pending = setTimeout(() => void refresh(), 120);
    };
    const timer = setInterval(() => void refresh(), 20_000);
    return () => {
      source.close();
      clearInterval(timer);
      clearTimeout(pending);
    };
  }, [refresh, notify]);

  const value = useMemo(() => (ws ? { ws, refresh, notify, act } : null), [ws, refresh, notify, act]);
  if (!value) return null;
  return (
    <Context.Provider value={value}>
      <div className="ws">
        <Sidebar />
        {children}
      </div>
      <div className="toasts" role="status">
        {notices.map((notice) => (
          <div key={notice.id} className="toast">
            <i className="dot" data-status={notice.tone === "done" ? "ok" : notice.tone === "failed" ? "bad" : "asking"} />
            {notice.text}
            {notice.href ? <Link href={notice.href}>Open</Link> : null}
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
