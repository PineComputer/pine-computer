import "server-only";
import type { RunView } from "@/shared/api";
import type { RunRecord, StoreData } from "./store";

/** A run as the page gets it: everything but its session token and cursor. */
export function view(run: RunRecord, data: Pick<StoreData, "computer">): RunView {
  const live = Boolean(run.token && data.computer?.binding && run.bindingRevision === data.computer.bindingRevision);
  return {
    id: run.id,
    target: run.target,
    checks: run.checks,
    askedAt: run.askedAt,
    state: run.state,
    waiting: run.waiting,
    doing: run.doing,
    question: run.question,
    summary: run.summary,
    endedAt: run.endedAt,
    findings: run.findings,
    screens: run.screens,
    moments: run.moments,
    stream: live ? `${run.id}:${run.bindingRevision}` : null,
    driving: Boolean(run.driving),
    idleDeadline: run.driving?.idleDeadline,
  };
}
