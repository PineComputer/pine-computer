"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { CoworkerView, SkillDraft as Draft } from "@/shared/api";
import { call, enc, errorText } from "../common/api";
import { Dialog } from "../common/kit";
import { Markdown } from "../common/Markdown";
import { useWorkspace } from "../app/Workspace";

/** A SKILL.md opens with its name and description between `---` lines; the rest is the skill. */
export function readSkill(body: string): { description: string; origin: string; text: string } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (!front) return { description: "", origin: "", text: body };
  const lines = front[1].split(/\r?\n/);
  const at = lines.findIndex((line) => /^description:/.test(line));
  let description = "";
  if (at >= 0) {
    // The value may run on over indented lines, or sit in a block (">" or "|").
    const parts = [lines[at].replace(/^description:\s*/, "").replace(/^[>|][+-]?\s*$/, "")];
    for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i += 1) parts.push(lines[i].trim());
    description = parts.join(" ").trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  // `origin` records the site it was learned on.
  const origin = lines.find((line) => /^origin:/.test(line))?.replace(/^origin:\s*/, "").trim() ?? "";
  return { description, origin, text: body.slice(front[0].length).trim() };
}

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

  const skill = draft?.body ? readSkill(draft.body) : null;
  const active = draft?.status === "active";
  return (
    <Dialog onClose={onClose} wide className="draft">
      <header className="draft-head">
        <span className="label">
          <Sparkles size={13} /> {active ? `A skill ${coworker.name} uses` : `A skill ${coworker.name} drafted`}
        </span>
        <h2>{name}</h2>
        {skill?.description ? <p>{skill.description}</p> : null}
        <div className="draft-meta">
          <span className="chip">Version {version}</span>
          <span className="chip">{active ? "Active" : draft ? "Draft: not in use yet" : "Loading"}</span>
          {skill?.origin ? <span className="chip">Learned on {skill.origin}</span> : null}
          <span className="chip">Stays on {coworker.name}&apos;s computer</span>
          {draft?.tainted ? <span className="chip warn">Touched a sign-in or payment field: read with care</span> : null}
        </div>
      </header>
      <div className="draft-body">
        {problem ? <p className="problem">{problem}</p> : skill ? <Markdown text={skill.text} /> : draft ? <p className="empty">The draft has no body.</p> : <p className="empty">Loading the draft…</p>}
      </div>
      <footer className="draft-foot">
        {active ? (
          <>
            <small>{coworker.name} follows this when a job calls for it.</small>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <small>Once activated, {coworker.name} uses it from its next job on.</small>
            <button className="btn ghost danger" aria-busy={busy === "discard"} disabled={!draft || busy !== null} onClick={() => void decide("discard")}>
              Discard
            </button>
            <button className="btn primary" aria-busy={busy === "activate"} disabled={!draft || busy !== null} onClick={() => void decide("activate")}>
              Activate
            </button>
          </>
        )}
      </footer>
    </Dialog>
  );
}
