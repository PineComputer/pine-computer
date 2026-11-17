// What this app's API answers, shared by the routes and the page. Types only.

export type Cadence = { kind: "interval"; minutes: number } | { kind: "daily"; at: string; weekdays: boolean };

/** One thing a check read off the page, under a name that stays the same from check to check. */
export interface Field {
  label: string;
  value: string;
}

/** A field whose value differs between two checks. "" means it wasn't there. */
export interface Difference {
  label: string;
  before: string;
  after: string;
}

export interface CheckView {
  id: string;
  watchId: string;
  /** first: made when the watch was created; schedule: the worker, at its time; hand: Check now. */
  trigger: "first" | "schedule" | "hand";
  /** The time a scheduled check was due. */
  dueAt?: string;
  startedAt: string;
  endedAt?: string;
  /** starting | running | asking | done | failed */
  state: string;
  /** While it runs: what the Computer is doing, in its words. */
  step?: string;
  /** Its browser has opened: the Computer's screen has something to see. */
  onScreen?: boolean;
  /** While it asks: the question (a sign-in, usually). */
  question?: string;
  /** Why it failed, as a sentence. */
  problem?: string;
  /** What it read. */
  fields?: Field[];
  /** Where on the screen it read them: "top left", "centre"… */
  place?: string;
  /** first: nothing to compare with; same: no change; changed: see `change`. */
  outcome?: "first" | "same" | "changed";
  /** The check it was compared with. */
  comparedWith?: string;
  /** What changed, in one sentence, and field by field. */
  change?: { sentence: string; differences: Difference[] };
  /** A picture of the screen was kept: GET /api/checks/:id/screen. */
  hasScreen: boolean;
}

export interface WatchView {
  id: string;
  /** What to watch, in the person's words. */
  what: string;
  /** Where: the page's address. */
  url: string;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  /** When the worker checks next. */
  nextAt: string;
  /** Why the last attempt didn't start (a limit on running Computers, say). It tries again. */
  waiting?: string;
  /** Newest first. */
  checks: CheckView[];
}

export interface AppState {
  watches: WatchView[];
  /** none: not created yet; stopped, starting, running, stopping. */
  computer: "none" | "stopped" | "starting" | "running" | "stopping";
  /** The check that has the Computer now. */
  live?: string;
  /** A person has the controls. */
  driving: boolean;
}

/** What the server pushes to open pages. */
export type LiveEvent = { type: "changed" };
