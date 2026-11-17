// A reader's public activity as this app's server relays it to the browser: the SDK's
// AgentEvent, trimmed to what the page draws. Types only, shared by both.

export interface Step {
  id: string;
  /** running | completed | failed | declined | interrupted */
  state: string;
  /** browser | command | file | skill | tool | … */
  kind: string;
  /** Imperative, written by the Computer. */
  title: string;
  /** The page a browser step ended on. */
  url?: string;
  /** That page's title. */
  page?: string;
}

export interface WireEvent {
  /** The run it belongs to: one stream carries every reader of a brief. */
  run: string;
  /** The cursor within the run's session. */
  id: number;
  /** When it happened, in ms since the epoch. */
  at: number;
  type: string;
  progress?: { text: string };
  step?: Step;
  /** The name of the saved picture of the screen after a step. Kept records only. */
  frame?: { src: string; stepId?: string };
  /** Who drives now: agent, human or locked. */
  controller?: string;
}
