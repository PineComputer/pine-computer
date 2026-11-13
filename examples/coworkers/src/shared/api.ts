// What this app's API answers, shared by the routes and the page. Types only, and the
// one convention the page and the server share: how a coworker asks for approval.

import type { Item } from "./fold";

/** idle; working: a job is running; asking: a question waits; yours: a person has its controls. */
export type Status = "idle" | "working" | "asking" | "yours";

export interface SkillView {
  name: string;
  description: string;
}

export interface CoworkerView {
  id: string;
  name: string;
  role: string;
  brief: string;
  color: string;
  suggestion?: string;
  createdAt: string;
  status: Status;
  /** none: not created yet (its first job creates it); stopped; starting; running; stopping. */
  computer: "none" | "stopped" | "starting" | "running" | "stopping";
  /** When its Computer stops itself if nothing uses it. */
  expiresAt?: string;
  skills: SkillView[];
  /** The thread a person is driving on its Computer. */
  driving?: string;
}

export interface ThreadView {
  id: string;
  coworker: string;
  title: string;
  createdAt: string;
  status: Status;
  /** Names the thread's open session and its sandbox, for the live stream; null while it has none. */
  stream: string | null;
}

export interface JobView {
  id: string;
  thread: string;
  coworker: string;
  kind: "run" | "answer";
  ask: string;
  askedAt: string;
  turnId?: string;
  /** queued | starting | running | canceling | needs_input | answered | completed | failed | canceled | stopped */
  state: string;
  waiting?: string;
  summary?: string;
  endedAt?: string;
  durationMs?: number;
  cost?: number | null;
  items?: Item[];
  files?: { path: string; size: number; contentType: string }[];
  /** drafting | asks (the skill author has questions) | draft | active | none */
  learn?: { state: string; name?: string; version?: number; questions?: string[]; reason?: string; startedAt: string };
}

export interface SecretView {
  name: string;
  note?: string;
  updatedAt: string;
}

export interface Workspace {
  coworkers: CoworkerView[];
  threads: ThreadView[];
  jobs: JobView[];
  secrets: SecretView[];
}

/** What the server pushes to the open pages. */
export type LiveEvent = { type: "changed" } | { type: "notice"; tone: "info" | "done" | "failed"; text: string; href?: string };

/** A skill version as the Computer reports it, with its SKILL.md to read before activating. */
export interface SkillDraft {
  name: string;
  version: number;
  /** pending (a draft), active, inactive */
  status: string;
  reason?: string;
  /** It touched a sign-in, MFA or payment field: read it with care. */
  tainted?: boolean;
  body?: string;
}

// ---- approvals ------------------------------------------------------------------
//
// Every job's context tells the coworker to stop before it spends, sends or submits,
// and to begin that question with this line. The thread then offers Approve and
// Decline beside the reply box. It is this app's convention, not the Computer's.

export const APPROVAL_MARK = "Approval needed:";
export const APPROVE = "Approved. Go ahead.";
export const DECLINE = "Declined. Don't do it. Stop here and tell me what you left undone.";

/** A question, and whether it asks for approval; the mark itself is not shown. */
export function question(summary: string): { approval: boolean; text: string } {
  const text = summary.trimStart();
  const marked = text.toLowerCase().startsWith(APPROVAL_MARK.toLowerCase());
  return { approval: marked, text: marked ? text.slice(APPROVAL_MARK.length).trimStart() : summary };
}
