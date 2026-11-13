"use client";

// Small pieces every view uses: a coworker's avatar, a dialog, a confirm, a ticking clock.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Status } from "@/shared/api";

const STATUS_WORDS: Record<Status, string> = { idle: "Idle", working: "Working", asking: "Has a question for you", yours: "You have its controls" };

/**
 * A coworker: a serif monogram on a seal of its own colour. With `status`, the ring
 * around it says what it is doing: turning while it works, amber when it's your turn.
 */
export function Avatar({ name, color, status, size }: { name: string; color: string; status?: Status; size?: "sm" | "lg" | "xl" }) {
  return (
    <span
      className={`avatar ${size ?? ""}`}
      data-color={color}
      data-status={status}
      role={status ? "img" : undefined}
      aria-label={status ? `${name}: ${STATUS_WORDS[status]}` : undefined}
      aria-hidden={status ? undefined : true}
      title={status && status !== "idle" ? STATUS_WORDS[status] : undefined}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

export function Dialog({ children, onClose, wide, className }: { children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""} ${className ?? ""}`} role="dialog" aria-modal="true">
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
