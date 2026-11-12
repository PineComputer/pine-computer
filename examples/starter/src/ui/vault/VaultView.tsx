"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Lock, Send, SquareTerminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SecretView } from "@/shared/api";
import { useApp } from "../app/AppProvider";
import { call, enc, errorText } from "../common/api";
import { Confirm } from "../common/kit";
import { relative } from "../common/format";
import "./vault.css";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why a name won't do, or null. The server checks the same rules. */
function nameProblem(name: string): string | null {
  if (!name) return null;
  if (!NAME.test(name)) return "Letters, digits and _, not starting with a digit.";
  if (/^(PINE_|AGENT_BROWSER_)/i.test(name)) return "Names starting with PINE_ or AGENT_BROWSER_ are reserved.";
  return null;
}

const STEPS = [
  { icon: Lock, title: "Sealed on this server", text: "Values are encrypted at rest here and never sent back to a browser, this page included." },
  { icon: Send, title: "Sent with every task", text: "Each task, answer and steer carries them as secrets. The Computer drops them on restart, so they go every time." },
  { icon: SquareTerminal, title: "Used as $NAME", text: "They land in a file only the session can read. The agent puts $NAME in the one command that needs it, so the model never sees the value, and values are redacted from events and results." },
];

/** Sign-ins and keys the agent uses without seeing them. */
export function VaultView() {
  const { toast } = useApp();
  const [secrets, setSecrets] = useState<SecretView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSecrets(await call<SecretView[]>("/api/vault"));
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-in">
        <div className="page-head">
          <div>
            <h1>Vault</h1>
            <p>Passwords, API keys and other values the agent needs but should never read. Refer to one in a task by its name.</p>
          </div>
        </div>

        <div className="how">
          {STEPS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="how-step">
              <span className="ico">
                <Icon />
              </span>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          ))}
        </div>

        <div className="example" aria-label="Example task">
          <span className="label">In a task</span>
          <code>
            Sign in to example.com as <span className="var">$EXAMPLE_USER</span> with <span className="var">$EXAMPLE_PASSWORD</span>
          </code>
        </div>

        <AddSecret existing={secrets ?? []} onSaved={(list) => setSecrets(list)} />

        <section className="card">
          <div className="card-head">
            <h2>Saved secrets</h2>
            {secrets ? <span className="badge">{secrets.length} of 64</span> : null}
          </div>
          {problem ? (
            <div className="card-body">
              <p className="problem">{problem}</p>
            </div>
          ) : secrets === null ? (
            <div className="empty-note">
              <span className="spinner" style={{ display: "inline-block", verticalAlign: "middle" }} />
            </div>
          ) : secrets.length === 0 ? (
            <div className="empty-note">No secrets yet. Add a sign-in above, then mention it in a task as $NAME.</div>
          ) : (
            <div className="rows">
              {secrets.map((secret) => (
                <div key={secret.name} className="row secret">
                  <span className="ico">
                    <KeyRound />
                  </span>
                  <div className="grow">
                    <span className="name">
                      ${secret.name}
                      <CopyName name={secret.name} />
                    </span>
                    {secret.note ? <div className="sub">{secret.note}</div> : null}
                  </div>
                  <span className="masked" aria-hidden="true">
                    ••••••••
                  </span>
                  <span className="when">updated {relative(Date.parse(secret.updatedAt))}</span>
                  <button className="btn ghost icon sm danger" aria-label={`Delete ${secret.name}`} title="Delete" onClick={() => setDeleting(secret.name)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {deleting ? (
        <Confirm
          title={`Delete $${deleting}?`}
          body="New tasks won't carry it. A session that's running keeps it until the session closes or the Computer restarts."
          action="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await call(`/api/vault/${enc(deleting)}`, { method: "DELETE" });
              toast({ tone: "done", text: `Deleted $${deleting}` });
              await load();
            } catch (error) {
              toast({ tone: "failed", text: errorText(error) });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function AddSecret({ existing, onSaved }: { existing: SecretView[]; onSaved: (list: SecretView[]) => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invalid = nameProblem(name);
  const replaces = !invalid && existing.some((s) => s.name === name);
  const multiline = /[\r\n]/.test(value);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      onSaved(await call<SecretView[]>("/api/vault", { body: { name, value, note } }));
      toast({ tone: "done", text: `${replaces ? "Replaced" : "Saved"} $${name}` });
      setName("");
      setValue("");
      setNote("");
      setShown(false);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Add a secret</h2>
      </div>
      <form
        className="card-body vault-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name && value && !invalid && !multiline && !saving) void save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            className="input mono"
            placeholder="EXAMPLE_PASSWORD"
            value={name}
            spellCheck={false}
            autoComplete="off"
            // Names read best in capitals; spaces and dashes become underscores.
            onChange={(event) => setName(event.target.value.toUpperCase().replace(/[\s-]+/g, "_"))}
          />
          {invalid ? <small className="err">{invalid}</small> : replaces ? <small className="note">Replaces the saved value.</small> : <small>Tasks refer to it as ${name || "NAME"}.</small>}
        </label>
        <label className="field">
          <span>Value</span>
          <div className="reveal">
            <input
              className="input mono"
              type={shown ? "text" : "password"}
              placeholder="One line"
              value={value}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
            />
            <button type="button" className="btn ghost icon sm" aria-label={shown ? "Hide the value" : "Show the value"} onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOff /> : <Eye />}
            </button>
          </div>
          {multiline ? <small className="err">One line only. Encode longer material, a PEM key say, as base64.</small> : <small>Sealed on this server. It never comes back to this page.</small>}
        </label>
        <label className="field wide">
          <span>Note (optional)</span>
          <input className="input" placeholder="What it's for, e.g. the staging admin account" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {problem ? <p className="problem wide">{problem}</p> : null}
        <div className="foot">
          <span className="hint">Up to 64 secrets, 32 KiB in all.</span>
          <button type="submit" className="btn primary" aria-busy={saving} disabled={!name || !value || Boolean(invalid) || multiline || saving}>
            <Lock /> {replaces ? "Replace" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}

function CopyName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost icon sm"
      aria-label={`Copy $${name}`}
      title={`Copy $${name}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`$${name}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // Clipboard access denied: nothing to copy into.
        }
      }}
    >
      {copied ? <Check style={{ color: "var(--ok)" }} /> : <Copy />}
    </button>
  );
}
