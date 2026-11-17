// What this app's API answers, shared by the routes and the page. Types only.

import type { Item } from "./fold";

export interface Angle {
  id: string;
  title: string;
  /** What this reader should find out. */
  focus: string;
}

/** A numbered source: a page a reader opened, with the picture of its screen there. */
export interface Source {
  n: number;
  url: string;
  title: string;
  host: string;
  /** The run that opened it, and the saved picture's name. */
  run: string;
  shot: string;
  reader: string;
  angle: string;
}

export interface Report {
  title: string;
  /** The short answer. Citations are [n], here and in each section's Markdown. */
  answer: string;
  sections: { angle: string; title: string; body: string }[];
  sources: Source[];
}

export interface RunView {
  id: string;
  /** plan: proposes the angles; read: one angle; write: the report. */
  kind: "plan" | "read" | "write";
  angle?: string;
  reader: string;
  /** queued | starting | running | canceling | needs_input | completed | failed | canceled | stopped */
  state: string;
  /** Why it waits in the queue, in words. */
  waiting?: string;
  /** A question it stopped on. */
  question?: string;
  /** Why it failed. */
  problem?: string;
  /** Its session is open: the live screen can be shown. Changes when a session is opened again. */
  live: string | null;
  /** A person has its controls. */
  driving: boolean;
  /** Its steps, kept once it has ended. */
  items?: Item[];
  /** How many pages it opened, and how many of its claims cited a page it never opened. */
  pages?: number;
  dropped?: number;
  /** The last screen it left. */
  lastShot?: string;
}

/** planning → draft (the angles, to edit) → reading → writing → done; or failed. */
export type BriefState = "planning" | "draft" | "reading" | "writing" | "done" | "failed";

export interface BriefSummary {
  id: string;
  question: string;
  createdAt: string;
  state: BriefState;
  title?: string;
  sources?: number;
}

export interface BriefView extends BriefSummary {
  angles: Angle[];
  problem?: string;
  report?: Report;
  runs: RunView[];
}

export interface ReaderView {
  id: string;
  name: string;
  /** none: not created yet; stopped; starting; running; stopping. */
  computer: "none" | "stopped" | "starting" | "running" | "stopping";
  /** When its Computer stops itself if nothing uses it. */
  expiresAt?: string;
  busy: boolean;
}

export interface Desk {
  briefs: BriefSummary[];
  readers: ReaderView[];
}

/** What the server pushes to the open pages. */
export type LiveEvent = { type: "changed" };
