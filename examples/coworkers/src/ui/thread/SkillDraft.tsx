"use client";

import { useEffect, useState } from "react";
import type { CoworkerView, SkillDraft as Draft } from "@/shared/api";
import { call, enc, errorText } from "../common/api";
import { Dialog } from "../common/kit";
import { useWorkspace } from "../app/Workspace";

/** A drafted skill, to read before it is activated: nothing learned is used until a person says so. */
export function SkillDraft({ coworker, name, version, onClose }: { coworker: CoworkerView; name: string; version: number; onClose: () => void }) {
  const { act } = useWorkspace();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const url = `/api/coworkers/${enc(coworker.id)}/skills/${enc(name)}/${version}`;

  useEffect(() => {
    call<Draft>(url).then(setDraft, (error) => setProblem(errorText(error)));
  }, [url]);

  const decide = async (action: "activate" | "discard") => {
    setBusy(action);
    const done = await act(() => call(url, { body: { action } }));
    setBusy(null);
    if (done) onClose();
  };

  return (
    <Dialog onClose={onClose} wide>
      <h2>
        A skill for {coworker.name}: <span className="mono">{name}</span>
      </h2>
      <p>Read the draft. Once activated, {coworker.name} uses it from its next job on; it stays on its Computer.</p>
      {problem ? <p className="problem">{problem}</p> : null}
      {draft?.tainted ? <p className="problem">This run touched a sign-in or payment field. Read it with care.</p> : null}
      <pre>{draft ? (draft.body ?? "The draft has no body.") : problem ? "" : "Loading the draft…"}</pre>
      <div className="actions">
        <button className="btn ghost danger" aria-busy={busy === "discard"} disabled={!draft || busy !== null} onClick={() => void decide("discard")}>
          Discard
        </button>
        <button className="btn primary" aria-busy={busy === "activate"} disabled={!draft || busy !== null} onClick={() => void decide("activate")}>
          Activate
        </button>
      </div>
    </Dialog>
  );
}
