// What this app's API answers, shared by the routes and the page. Types only, and the
// one convention the page and the server share: how a run asks for approval.

/** A picture of the Computer's screen, saved from the run's event stream. */
export interface Screen {
  /** The saved picture's name: its event's id and its type. */
  name: string;
  at: string;
  /** The step that left it, in the Computer's own words. */
  caption: string;
  /** The page it shows. */
  url?: string;
}

/** One check, as the Computer's agent recorded it, with the screens this app kept for it. */
export interface Finding {
  n: number;
  title: string;
  status: "passed" | "failed";
  expected: string;
  observed: string;
  /** The page where it was observed, and where on it to look. */
  url: string;
  where: string;
  /** The steps to reproduce, in plain words. */
  steps: string[];
  at: string;
  /** The screens on the way to this check, oldest first: saved pictures' names. */
  screens: string[];
  /**
   * The screen kept as evidence: the last one taken on the page the finding names
   * before the check was recorded. Absent when no saved screen shows that page.
   */
  evidence?: string;
}

/** Something a person decided or did in the run. */
export interface Moment {
  at: string;
  /** asked: the run stopped with a question; approved, declined, answered; took, returned: the controls. */
  kind: "asked" | "approved" | "declined" | "answered" | "took" | "returned";
  text?: string;
}

export interface RunView {
  id: string;
  /** The address under test. */
  target: string;
  /** What to check, in the person's words. */
  checks: string;
  askedAt: string;
  /** queued | starting | running | canceling | needs_input | completed | failed | canceled | stopped */
  state: string;
  /** Why it waits in the queue. */
  waiting?: string;
  /** What the Computer is doing now, in plain words. */
  doing?: string;
  /** The question it stopped on, and whether it asks for approval. */
  question?: string;
  /** How it ended, in a sentence. */
  summary?: string;
  endedAt?: string;
  findings: Finding[];
  screens: Screen[];
  moments: Moment[];
  /** Names the run's open session and its sandbox, for the live screen; null while it has none. */
  stream: string | null;
  /** A person has the controls. */
  driving: boolean;
  /** When the person's turn at the controls ends unless they act. */
  idleDeadline?: string;
}

export interface Workspace {
  /** none: not created yet (the first run creates it); stopped; starting; running; stopping. */
  computer: "none" | "stopped" | "starting" | "running" | "stopping";
  /** When the Computer stops itself if nothing uses it. */
  expiresAt?: string;
  runs: RunView[];
}

/** What the server pushes to the open pages. */
export type LiveEvent = { type: "changed" };

// ---- approvals ------------------------------------------------------------------
//
// Every run's context tells the agent to stop before it submits a payment, places an
// order or sends something real, and to begin that question with this line. The run
// then offers Approve and Decline. It is this app's convention, not the Computer's.

export const APPROVAL_MARK = "Approval needed:";
export const APPROVE = "Approved. Go ahead, then finish the remaining checks.";
export const DECLINE = "Declined. Don't do it. Record that check as failed with the observation that the step was declined, then finish the checks that don't need it.";

/** A question, and whether it asks for approval; the mark itself is not shown. */
export function question(summary: string): { approval: boolean; text: string } {
  const text = summary.trimStart();
  const marked = text.toLowerCase().startsWith(APPROVAL_MARK.toLowerCase());
  return { approval: marked, text: marked ? text.slice(APPROVAL_MARK.length).trimStart() : summary };
}

const WORKING = new Set(["queued", "starting", "running", "canceling"]);
export const working = (run: Pick<RunView, "state">) => WORKING.has(run.state);
export const open = (run: Pick<RunView, "state">) => working(run) || run.state === "needs_input";

/** "5 checks · 2 failed", the report's summary line. */
export function tally(findings: Pick<Finding, "status">[]): { checks: number; failed: number; passed: number; words: string } {
  const failed = findings.filter((f) => f.status === "failed").length;
  const checks = findings.length;
  const words = `${checks} ${checks === 1 ? "check" : "checks"}, ${failed === 0 ? (checks ? "all passed" : "none recorded") : `${failed} failed`}`;
  return { checks, failed, passed: checks - failed, words };
}

/** A target as a person reads it: without the scheme, or a trailing slash. */
export function host(target: string): string {
  return target.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}
