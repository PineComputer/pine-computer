"use client";

// Small pieces every view uses: a coworker's avatar, a dialog, a confirm, a ticking clock.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Status } from "@/shared/api";

const STATUS_WORDS: Record<Status, string> = { idle: "Idle", working: "Working", asking: "Has a question for you", yours: "You have its controls" };

/** A monogram in the coworker's own colour; with `status`, a dot at its corner. */
export function Avatar({ name, color, status, size }: { name: string; color: string; status?: Status; size?: "sm" | "lg" }) {
  return (
    <span className={`avatar ${size ?? ""}`} data-color={color} aria-hidden={status ? undefined : true}>
      {name[0]?.toUpperCase()}
      {status ? <i className="dot" data-status={status} role="img" aria-label={STATUS_WORDS[status]} title={STATUS_WORDS[status]} /> : null}
    </span>
  );
}

export function Dialog({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A yes-or-no question before something that can't be undone. */
export function Confirm({ title, body, action, onConfirm, onClose }: { title: string; body: ReactNode; action: string; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog onClose={onClose}>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn danger"
          aria-busy={busy}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {action}
        </button>
      </div>
    </Dialog>
  );
}

/** The time now, ticking every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
