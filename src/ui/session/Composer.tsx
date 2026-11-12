"use client";

import { ArrowUp, KeyRound, Paperclip, Square, X } from "lucide-react";
import { forwardRef, useRef, useState } from "react";
import { brand } from "@/brand";
import type { SecretView } from "@/shared/api";
import { call, errorText } from "../common/api";

export type ComposerMode = "run" | "steer" | "answer" | "off";

const PLACEHOLDER: Record<ComposerMode, string> = {
  run: `What should ${brand.agent} do?`,
  steer: "Steer it while it works…",
  answer: `Answer ${brand.agent}…`,
  off: "Start the Computer to give it a task",
};

const MODE_WORDS: Record<ComposerMode, string> = {
  run: "New task",
  steer: "Steering",
  answer: "Answering",
  off: "",
};

/**
 * One box for every reply: a new task, a steer while it works, or the answer it asked
 * for. A task can carry files (they land in attachments/) and name vault secrets as
 * $NAME, which the agent uses without seeing.
 */
export const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    session: string;
    mode: ComposerMode;
    text: string;
    onText: (text: string) => void;
    attachments: string[];
    onAttachments: (names: string[]) => void;
    onSubmit: () => Promise<void>;
    onCancel?: () => Promise<void>;
    onProblem: (text: string) => void;
  }
>(function Composer({ session, mode, text, onText, attachments, onAttachments, onSubmit, onCancel, onProblem }, ref) {
  const [busy, setBusy] = useState<"send" | "cancel" | "attach" | null>(null);
  const [vault, setVault] = useState<SecretView[] | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const act = async (which: "send" | "cancel", run: () => Promise<void>) => {
    setBusy(which);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };
  const canSend = mode !== "off" && text.trim().length > 0 && busy === null;
  const label = mode === "steer" ? "Steer" : mode === "answer" ? "Answer" : "Send";

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("attach");
    try {
      const names = [...attachments];
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const { name } = await call<{ name: string }>(`/api/sessions/${encodeURIComponent(session)}/files`, { body: form });
        if (!names.includes(name)) names.push(name);
      }
      onAttachments(names);
    } catch (error) {
      onProblem(errorText(error));
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = "";
    }
  };

  const insert = (name: string) => {
    const spaced = text && !/\s$/.test(text) ? " " : "";
    onText(`${text}${spaced}$${name} `);
    setVault(null);
  };

  return (
    <form
      className="composer"
      data-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void act("send", onSubmit);
      }}
      onDragOver={(event) => mode === "run" && event.preventDefault()}
      onDrop={(event) => {
        if (mode !== "run") return;
        event.preventDefault();
        void attach(event.dataTransfer.files);
      }}
    >
      {attachments.length ? (
        <div className="chips">
          {attachments.map((name) => (
            <span key={name} className="chip">
              <Paperclip /> {name}
              <button type="button" aria-label={`Remove ${name}`} onClick={() => onAttachments(attachments.filter((n) => n !== name))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <label className="sr-only" htmlFor="composer">
        {PLACEHOLDER[mode]}
      </label>
      <textarea
        ref={ref}
        id="composer"
        value={text}
        placeholder={PLACEHOLDER[mode]}
        disabled={mode === "off"}
        rows={2}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) void act("send", onSubmit);
          }
        }}
      />
      <div className="composer-bar">
        <input ref={picker} type="file" multiple hidden onChange={(event) => void attach(event.target.files)} />
        <button
          type="button"
          className="btn ghost icon sm"
          title="Attach files: they land in attachments/ for the agent"
          aria-label="Attach files"
          aria-busy={busy === "attach"}
          disabled={mode !== "run" || busy !== null}
          onClick={() => picker.current?.click()}
        >
          <Paperclip />
        </button>
        <span style={{ position: "relative" }}>
          <button
            type="button"
            className="btn ghost icon sm"
            title="Use a vault secret as $NAME: the agent uses it without seeing it"
            aria-label="Insert a vault secret"
            disabled={mode === "off"}
            onClick={async () => {
              if (vault) return setVault(null);
              setVault(await call<SecretView[]>("/api/vault").catch(() => []));
            }}
          >
            <KeyRound />
          </button>
          {vault ? (
            <div className="vault-pop" role="menu">
              {vault.length ? (
                vault.map((secret) => (
                  <button key={secret.name} type="button" role="menuitem" onClick={() => insert(secret.name)}>
                    <KeyRound size={12} /> ${secret.name}
                  </button>
                ))
              ) : (
                <div className="empty-note">
                  The vault is empty. Add sign-ins in <a href="/vault">Vault</a>.
                </div>
              )}
            </div>
          ) : null}
        </span>
        <span className="mode">{MODE_WORDS[mode]}</span>
        <span className="push">
          {onCancel && (mode === "steer" || mode === "answer") ? (
            <button type="button" className="btn ghost sm" aria-busy={busy === "cancel"} disabled={busy !== null} onClick={() => void act("cancel", onCancel)}>
              {mode === "steer" ? <Square fill="currentColor" size={10} /> : null} {mode === "steer" ? "Stop" : "Dismiss"}
            </button>
          ) : null}
          <button type="submit" className={`btn sm ${mode === "steer" ? "" : "primary"}`} aria-busy={busy === "send"} disabled={!canSend}>
            {label} <ArrowUp />
          </button>
        </span>
      </div>
    </form>
  );
});
