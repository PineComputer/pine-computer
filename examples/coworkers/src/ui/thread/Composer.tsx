"use client";

import { ArrowUp, KeyRound, Square } from "lucide-react";
import { useRef, useState } from "react";
import { useWorkspace } from "../app/Workspace";

export interface ComposerProps {
  /** job: a new job; steer: guidance while it works. */
  mode: "job" | "steer";
  name: string;
  onSend: (text: string) => Promise<boolean>;
  /** Stops the job under way. */
  onStop?: () => void;
}

const PLACEHOLDER = {
  job: (name: string) => `Give ${name} a job`,
  steer: (name: string) => `Steer ${name} while it works`,
};
const HINT = { job: "", steer: "It reads this at its next step" };

/** One box for both: what a message means depends on what the coworker is doing. */
export function Composer({ mode, name, onSend, onStop }: ComposerProps) {
  const { ws } = useWorkspace();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    if (await onSend(words)) setText("");
    setBusy(false);
    box.current?.focus();
  };

  return (
    <div className="composer-wrap">
      {vault ? (
        <div className="pop" role="menu">
          {ws.secrets.length ? (
            ws.secrets.map((secret) => (
              <button
                key={secret.name}
                role="menuitem"
                onClick={() => {
                  setText((now) => `${now}${now && !now.endsWith(" ") ? " " : ""}$${secret.name} `);
                  setVault(false);
                  box.current?.focus();
                }}
              >
                ${secret.name}
              </button>
            ))
          ) : (
            <p>The vault is empty. Add a secret from the sidebar.</p>
          )}
        </div>
      ) : null}
      <div className="composer" data-mode={mode}>
        <textarea
          ref={box}
          value={text}
          rows={2}
          placeholder={PLACEHOLDER[mode](name)}
          aria-label={PLACEHOLDER[mode](name)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-bar">
          <button className="btn ghost sm icon" title="Use a secret from the vault" aria-label="Use a secret from the vault" aria-expanded={vault} onClick={() => setVault((open) => !open)}>
            <KeyRound />
          </button>
          <span className="mode">{HINT[mode]}</span>
          <span className="push">
            {onStop ? (
              <button className="btn sm" onClick={onStop}>
                <Square /> Stop
              </button>
            ) : null}
            <button className="btn sm icon primary" aria-label="Send" aria-busy={busy} disabled={busy || !text.trim()} onClick={() => void send()}>
              <ArrowUp />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
