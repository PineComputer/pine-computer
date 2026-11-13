"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { call, enc } from "../common/api";
import { Dialog } from "../common/kit";
import { useWorkspace } from "./Workspace";

/** The workspace's secrets: added here, used in a message as $NAME, and never shown again. */
export function Vault({ onClose }: { onClose: () => void }) {
  const { ws, act } = useWorkspace();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog onClose={onClose}>
      <h2>Vault</h2>
      <p>
        Write <span className="secret">$NAME</span> in a message and the coworker uses the value without seeing it. Values never reach the model or the chat.
      </p>
      {ws.secrets.length ? (
        <ul className="vault-list">
          {ws.secrets.map((secret) => (
            <li key={secret.name}>
              <span className="secret">${secret.name}</span>
              <span className="note">{secret.note}</span>
              <button className="btn ghost sm icon" aria-label={`Delete ${secret.name}`} onClick={() => void act(() => call(`/api/vault/${enc(secret.name)}`, { method: "DELETE" }))}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        style={{ display: "grid", gap: 10 }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          const saved = await act(() => call("/api/vault", { body: { name, value, note } }));
          setBusy(false);
          if (!saved) return;
          setName("");
          setValue("");
          setNote("");
        }}
      >
        <div className="grid-2">
          <label className="field">
            <span>Name</span>
            <input className="input mono" value={name} placeholder="CRM_PASSWORD" autoComplete="off" onChange={(event) => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
          </label>
          <label className="field">
            <span>Value</span>
            <input className="input" type="password" value={value} autoComplete="new-password" onChange={(event) => setValue(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Note</span>
          <input className="input" value={note} placeholder="What it is for (optional)" onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Done
          </button>
          <button className="btn primary" aria-busy={busy} disabled={busy || !name || !value}>
            Add secret
          </button>
        </div>
      </form>
    </Dialog>
  );
}
