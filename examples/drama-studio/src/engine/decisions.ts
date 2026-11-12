// A maker's decision on a review, as the one answer the agent receives. Notes name the
// exact file they were made on, so the agent knows which version the maker looked at;
// the maker's own words are quoted, for the record the drama skill keeps of approvals.
import type { Decision, Note, ReviewKind } from "../shared/types.ts";

export interface DecisionContext {
  kind: ReviewKind;
  /** What was reviewed, e.g. "EP002's storyboards" or "the leads' looks". */
  subject: string;
  /** Item key → how the agent named it (seg03, Lin Xiaoyu…). */
  labels: Map<string, string>;
  /** File id → its path in the session's working directory. */
  paths: Map<number, string>;
  /** A note's own picture → the name it was attached under, in the session's attachments/. */
  images?: Map<number, string>;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function where(note: Note, paths: Map<number, string>, images?: Map<number, string>): string {
  const parts: string[] = [];
  const image = note.image !== undefined ? images?.get(note.image) : undefined;
  const file = note.fileId !== undefined ? paths.get(note.fileId) : undefined;
  if (file) parts.push(`on ${file}`);
  if (note.x !== undefined && note.y !== undefined) parts.push(`at ${percent(note.x)} across and ${percent(note.y)} down`);
  if (note.time !== undefined) parts.push(`at ${clock(note.time)}`);
  if (image) parts.push(`see the picture I attached: attachments/${image}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function answerText(decision: Decision, context: DecisionContext): string {
  const words = decision.words.trim();
  if (context.kind === "question") return words;

  const label = (key: string) => context.labels.get(key) ?? key;
  const approved = decision.items.filter((item) => item.verdict === "approve");
  const revise = decision.items.filter((item) => item.verdict === "revise");
  const lines = [`My review of ${context.subject}.`];

  if (approved.length) {
    lines.push(revise.length ? `Approved: ${approved.map((item) => label(item.key)).join(", ")}.` : `Approved: all ${approved.length}.`);
  }
  if (revise.length) {
    lines.push("Revise:");
    for (const item of revise) {
      const notes = item.notes.filter((note) => note.text.trim() || note.image !== undefined);
      if (!notes.length) lines.push(`- ${label(item.key)}: please redo it.`);
      for (const note of notes) lines.push(`- ${label(item.key)}: ${note.text.trim() || "use the picture I attached"}${where(note, context.paths, context.images)}`);
    }
  }
  // Notes on approved items are kept as remarks: approved, with something to know.
  for (const item of approved) {
    for (const note of item.notes.filter((n) => n.text.trim() || n.image !== undefined)) {
      lines.push(`Remark on ${label(item.key)}: ${note.text.trim() || "the picture I attached"}${where(note, context.paths, context.images)}`);
    }
  }
  if (words) lines.push(`In my own words: "${words}"`);
  return lines.join("\n");
}

/** The item keys an answer asks to revise, read back from answerText's form. */
export function revisedKeys(answer: string): string[] {
  const keys: string[] = [];
  let inRevise = false;
  for (const line of answer.split("\n")) {
    if (line.startsWith("Revise:")) inRevise = true;
    else if (inRevise && line.startsWith("- ")) {
      const key = line.slice(2).split(":")[0].trim();
      if (key && !keys.includes(key)) keys.push(key);
    } else if (inRevise && line.trim()) inRevise = false;
  }
  return keys;
}
