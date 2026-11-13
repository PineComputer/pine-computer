// A coworker's public activity as this app's server relays it to the browser: the SDK's
// AgentEvent and ControlEvent, trimmed to what the page draws. Types only, shared by both.

export interface Step {
  id: string;
  /** running | completed | failed | declined | interrupted */
  state: string;
  /** browser | command | file | skill | tool | … */
  kind: string;
  /** Imperative, written by the Computer: show it as is. */
  title: string;
  /** The page a browser step ended on. */
  url?: string;
}

export interface Outcome {
  /** completed | needs_input | canceled | failed… (the result's terminal reason) */
  reason: string;
  /** The answer, a question, or why the turn stopped. */
  summary: string;
  files: { path: string; size: number }[];
  durationMs: number;
  cost: number | null;
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
  /** When the person's turn at the controls ends unless they act. */
  idleDeadline?: string;
}
