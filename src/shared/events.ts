// The agent's public activity as this app's server relays it to the browser: the SDK's
// AgentEvent and ControlEvent, trimmed to what the page draws. Types only, shared by both.

export interface StepFacts {
  /** The page a browser step ended on. */
  page?: { title?: string; url?: string };
  /** The actions a browser step ran, in order. */
  steps?: string[];
  files?: { path: string; change: string }[];
  skill?: { name: string };
}

export interface Step {
  id: string;
  /** running | completed | failed | declined | interrupted */
  state: string;
  /** browser | command | file | skill | tool | … */
  kind: string;
  /** Imperative, written by the Computer: show it as is. */
  title: string;
  facts?: StepFacts;
}

export interface Outcome {
  /** completed | needs_input | canceled | failed… (the result's terminal reason) */
  reason: string;
  /** The answer, a question, or why the turn stopped. */
  summary: string;
  files: { path: string; size: number }[];
  durationMs: number;
  cost: number | null;
  /** An authoring run's outcome: the draft it registered, or what it needs to know. */
  author?: { draft?: { name: string; version: number }; questions: string[]; handoffId: string };
}

export interface WireEvent {
  /** The Task-local cursor. */
  id: number;
  turnId: string;
  /** When it happened, in ms since the epoch. */
  at: number;
  type: string;
  input?: { kind: string; text: string };
  progress?: { text: string };
  step?: Step;
  /** A picture of the screen after a step, as a data URL. */
  frame?: { src: string; stepId?: string };
  /** Who drives now: agent, human or locked. */
  controller?: string;
  outcome?: Outcome;
}

/** A change in who drives the session (SSE event `control`). */
export interface WireControl {
  id: number;
  /** controller_changed | idle_changed | handoff_completed | handoff_failed */
  type: string;
  controller?: string;
  /** The session a person drives on this Computer, if any: one at a time. */
  humanSession?: string;
  handoffId?: string;
  /** When the person's turn at the controls ends unless they act. */
  idleDeadline?: string;
  idlePaused?: boolean;
}
