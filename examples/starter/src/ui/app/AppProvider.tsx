"use client";

// The page's picture of the user's Computer, shared by every view. It reads /api/app
// again whenever /api/live says something changed, and turns what the server pushes
// (a finished task, a site asking for a passkey) into toasts.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, Ceremony, LiveEvent } from "@/shared/api";
import { call, errorText } from "../common/api";

export type Lifecycle = "create" | "start" | "stop" | "pause" | "resume" | "recover" | "delete";

export interface Toast {
  id: string;
  tone: "info" | "done" | "failed";
  title?: string;
  text: string;
  href?: string;
}

interface AppContextValue {
  app: AppState | null;
  refresh: () => Promise<void>;
  /** The lifecycle action under way, if any. */
  busy: Lifecycle | null;
  lifecycle: (action: Lifecycle, extra?: Record<string, unknown>) => Promise<boolean>;
  toasts: Toast[];
  toast: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  ceremonies: Ceremony[];
  decide: (id: string, decision: "approve" | "decline") => Promise<void>;
  palette: boolean;
  setPalette: (open: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside AppProvider");
  return value;
}

const LIFECYCLE_DONE: Partial<Record<Lifecycle, string>> = {
  create: "Your Computer is ready",
  start: "Started from its saved state",
  stop: "Stopped. Sign-ins, cookies and skills are saved",
  pause: "Paused with everything in memory",
  resume: "Resumed where it was",
  recover: "Recovered from its saved state",
  delete: "Deleted for good",
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<Lifecycle | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ceremonies, setCeremonies] = useState<Ceremony[]>([]);
  const [palette, setPalette] = useState(false);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (next: Omit<Toast, "id">) => {
      const id = `t${(counter.current += 1)}`;
      setToasts((all) => [...all.slice(-3), { ...next, id }]);
      setTimeout(() => dismiss(id), next.tone === "failed" ? 9000 : 5000);
    },
    [dismiss],
  );

  const refresh = useCallback(async () => {
    try {
      setApp(await call<AppState>("/api/app"));
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    }
  }, [toast]);

  // Read again when the server says so (batched), and now and then for the idle clock.
  useEffect(() => {
    void refresh();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void refresh(), 150);
    };
    const source = new EventSource("/api/live");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      if (event.type === "changed") soon();
      else if (event.type === "passkeys") setCeremonies(event.ceremonies);
      else if (event.type === "notice") toast({ tone: event.tone, text: event.text, href: event.href });
    };
    const timer = setInterval(() => void refresh(), 20_000);
    return () => {
      source.close();
      clearInterval(timer);
      clearTimeout(pending);
    };
  }, [refresh, toast]);

  const lifecycle = useCallback(
    async (action: Lifecycle, extra: Record<string, unknown> = {}) => {
      setBusy(action);
      try {
        await call("/api/computer", { body: { action, ...extra } });
        await refresh();
        const done = LIFECYCLE_DONE[action];
        if (done) toast({ tone: "done", text: done });
        return true;
      } catch (error) {
        toast({ tone: "failed", title: "That didn't work", text: errorText(error) });
        await refresh();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const decide = useCallback(
    async (id: string, decision: "approve" | "decline") => {
      try {
        await call(`/api/passkeys/ceremonies/${encodeURIComponent(id)}`, { body: { decision } });
        setCeremonies((all) => all.filter((c) => c.id !== id));
        toast({ tone: "done", text: decision === "approve" ? "Passkey created and kept on the Computer" : "Declined. The site was told it failed" });
      } catch (error) {
        toast({ tone: "failed", text: errorText(error) });
      }
    },
    [toast],
  );

  // ⌘K / Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(
    () => ({ app, refresh, busy, lifecycle, toasts, toast, dismiss, ceremonies, decide, palette, setPalette }),
    [app, refresh, busy, lifecycle, toasts, toast, dismiss, ceremonies, decide, palette],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
