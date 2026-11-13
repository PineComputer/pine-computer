"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "../common/api";
import { Dialog } from "../common/kit";
import { useWorkspace } from "./Workspace";

/** A new coworker: a name, a role and a brief. Its Computer comes with its first job. */
export function Hire({ onClose }: { onClose: () => void }) {
  const { act } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim() && role.trim() && brief.trim();
  return (
    <Dialog onClose={onClose}>
      <h2>Hire a coworker</h2>
      <p>It gets a computer of its own with its first job: its own sign-ins, files and skills.</p>
      <form
        style={{ display: "grid", gap: 14 }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          const hired = await act(() => call<{ id: string }>("/api/coworkers", { body: { name, role, brief } }));
          setBusy(false);
          if (!hired) return;
          onClose();
          router.push(`/c/${hired.id}`);
        }}
      >
        <div className="grid-2">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} maxLength={24} placeholder="Noor" autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Role</span>
            <input className="input" value={role} maxLength={40} placeholder="Bookkeeper" onChange={(event) => setRole(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Brief</span>
          <textarea className="textarea" value={brief} maxLength={600} placeholder="How it works and what it is for. It goes with every job." onChange={(event) => setBrief(event.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" aria-busy={busy} disabled={busy || !ready}>
            Hire
          </button>
        </div>
      </form>
    </Dialog>
  );
}
