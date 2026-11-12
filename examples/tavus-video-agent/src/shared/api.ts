// What the server and the page say to each other.

export interface Step {
  id: string;
  /** running | completed | failed | declined | interrupted */
  state: string;
  kind: string;
  title: string;
  page?: string;
  at: string;
}

export interface CaseView {
  id: string;
  state: "working" | "needs_input" | "done" | "failed" | "stopped";
  request: { product: string; issue: string; resolution: string; details: string };
  question?: string;
  questionKind?: "approval" | "info";
  summary?: string;
  claimNumber?: string;
  verified?: boolean;
  files: { path: string; name: string; size: number }[];
  log: { at: string; who: "customer" | "pal" | "computer" | "operator" | "check"; text: string }[];
  startedAt: string;
  endedAt?: string;
  cost: number;
}

export interface ComputerView {
  /** none | stopped | starting | running | paused | failed */
  state: string;
  session?: string;
  idleTimeoutSeconds?: number;
  stopAt?: string;
}

export interface Snapshot {
  computer: ComputerView;
  claim: CaseView | null;
  steps: Step[];
  tavus: { configured: boolean; palId?: string; /** The PAL's first name, and whether it calls the tools itself ("pal") or the page does ("page"). */ name: string; mode: "pal" | "page" };
  portal: { url: string; staff: boolean };
  /** What the claim would tell a live call now: a new call's context already carries it. */
  nudge: Nudge | null;
}

/**
 * Something the live call should hear: the agent asked a question, or finished. The page appends
 * `context` to the PAL's context and sends `prompt` as a respond interaction, once per conversation.
 */
export interface Nudge {
  id: string;
  kind: "question" | "done" | "failed";
  context: string;
  prompt: string;
}

export type LiveEvent =
  | { type: "case"; claim: CaseView | null }
  | { type: "computer"; computer: ComputerView }
  | { type: "step"; step: Step }
  | { type: "progress"; text: string }
  | { type: "nudge"; nudge: Nudge }
  | { type: "control"; controller: string };

/** The PAL's tools, as Tavus calls them. */
export const TOOLS = {
  start: "start_warranty_claim",
  answer: "answer_claim_question",
  status: "get_claim_status",
} as const;
