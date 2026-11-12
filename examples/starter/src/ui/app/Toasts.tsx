"use client";

import { Fingerprint, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "./AppProvider";

/** What just happened, bottom right; a site asking for a passkey stays until someone decides. */
export function Toasts() {
  const { toasts, dismiss, ceremonies, decide, app } = useApp();
  const [deciding, setDeciding] = useState<string | null>(null);
  const label = (name: string) => app?.sessions.find((s) => s.name === name)?.label ?? name;

  return (
    <div className="toasts" aria-live="polite">
      {ceremonies.map((c) => (
        <div key={c.id} className="toast human" role="alertdialog" aria-label={`${c.rpId} wants a passkey`}>
          <Fingerprint size={16} style={{ color: "var(--human)", marginTop: 2 }} />
          <div>
            <b>{c.rpId} wants to create a passkey</b>
            <p>
              {c.userName ? `For ${c.userName}, ` : ""}in {label(c.session)}. Approve and the Computer creates it and keeps it; its private key never leaves.
            </p>
            <div className="acts">
              <button
                className="btn sm primary"
                aria-busy={deciding === c.id}
                disabled={deciding !== null}
                onClick={async () => {
                  setDeciding(c.id);
                  await decide(c.id, "approve");
                  setDeciding(null);
                }}
              >
                Approve
              </button>
              <button className="btn sm ghost" disabled={deciding !== null} onClick={() => void decide(c.id, "decline")}>
                Decline
              </button>
            </div>
          </div>
          <span />
        </div>
      ))}
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span className="dot" data-tone={t.tone === "done" ? "ok" : t.tone === "failed" ? "bad" : "agent"} />
          <div>
            {t.title ? <b>{t.title}</b> : null}
            <p>
              {t.href ? (
                <Link href={t.href} onClick={() => dismiss(t.id)} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                  {t.text}
                </Link>
              ) : (
                t.text
              )}
            </p>
          </div>
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
