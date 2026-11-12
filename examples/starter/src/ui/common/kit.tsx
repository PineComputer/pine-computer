"use client";

// Small pieces every view uses: a switch, a confirm dialog, a ticking clock.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Dialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A yes-or-no question before something that can't be undone; `word` must be typed when given. */
export function Confirm({
  title,
  body,
  action,
  word,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  action: string;
  word?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog onClose={onClose}>
      <h2>{title}</h2>
      <p>{body}</p>
      {word ? (
        <label className="field">
          <span>
            Type <b className="mono">{word}</b> to confirm
          </span>
          <input className="input mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
        </label>
      ) : null}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn danger"
          aria-busy={busy}
          disabled={busy || (word !== undefined && typed !== word)}
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

/** A country's flag, from its two-letter code. */
export function flag(code: string | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

export function countryName(code: string | undefined): string {
  if (!code) return "Automatic";
  if (code === "direct") return "Direct";
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
