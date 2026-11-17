"use client";

// The page's picture of the desk, shared by every view: its briefs and its readers. It
// reads /api/desk again whenever /api/live says something changed; `version` counts
// those changes, so a view that reads more (a brief) knows to read again too.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { brand } from "@/brand";
import type { Desk as DeskState } from "@/shared/api";
import { call, errorText } from "../common/api";
import { Readers } from "./Readers";
import { ThemeToggle } from "./Theme";

interface DeskContext {
  desk: DeskState;
  version: number;
  /** Runs a call to this app's API; a failure is shown under the bar and resolves undefined. */
  act: <T>(run: () => Promise<T>) => Promise<T | undefined>;
}

const Context = createContext<DeskContext | null>(null);

export function useDesk(): DeskContext {
  const value = useContext(Context);
  if (!value) throw new Error("useDesk outside Desk");
  return value;
}

export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="4" width="4.6" height="16" fill="currentColor" />
      <rect x="9.7" y="4" width="4.6" height="16" fill="currentColor" />
      <rect x="16.4" y="4" width="4.6" height="16" fill="var(--accent)" />
    </svg>
  );
}

export function Desk({ children }: { children: ReactNode }) {
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [version, setVersion] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDesk(await call<DeskState>("/api/desk"));
      setVersion((n) => n + 1);
    } catch (error) {
      setProblem(errorText(error));
    }
  }, []);

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

  const value = useMemo(() => (desk ? { desk, version, act } : null), [desk, version, act]);
  if (!value) return null;
  return (
    <Context.Provider value={value}>
      <div className="app">
        <header className="top">
          <Link href="/" className="logo">
            <Logo />
            {brand.name}
          </Link>
          <div className="end">
            <Readers />
            <ThemeToggle />
          </div>
        </header>
        {problem ? (
          <p className="problem bar-problem" role="alert">
            {problem}
            <button className="btn ghost sm" onClick={() => setProblem(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
        {children}
      </div>
    </Context.Provider>
  );
}
