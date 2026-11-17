"use client";

import type { CheckView, WatchView } from "@/shared/api";
import { clock } from "./format";

/** How a check came to be made. "Check now" is never shown as a scheduled check. */
export const TRIGGER: Record<CheckView["trigger"], string> = { schedule: "scheduled", hand: "checked by hand", first: "first check" };

/** A check in a word, and the dot beside it. */
export function outcomeOf(check: CheckView): { tone: string; word: string } {
  if (check.state === "asking") return { tone: "human", word: "Needs you" };
  if (check.state === "starting" || check.state === "running") return { tone: "live", word: "Checking" };
  if (check.state === "failed") return { tone: "bad", word: "Didn't finish" };
  if (check.outcome === "changed") return { tone: "changed", word: "Changed" };
  if (check.outcome === "first") return { tone: "quiet", word: "First look" };
  return { tone: "quiet", word: "No change" };
}

/** A watch's checks, newest first: one quiet line each, and a sentence where something changed. */
export function Feed({ watch, current, onOpen }: { watch: WatchView; current?: string; onOpen: (id: string) => void }) {
  return (
    <div className="feed">
      <div className="side-title">
        <span className="label">Checks</span>
      </div>
      {watch.checks.map((check) => {
        const { tone, word } = outcomeOf(check);
        return (
          <button key={check.id} className="check" data-outcome={check.outcome} aria-current={check.id === current} onClick={() => onOpen(check.id)}>
            <time>{clock(check.endedAt ?? check.dueAt ?? check.startedAt)}</time>
            <span className="line">
              <i className="dot" data-tone={tone} />
              <b data-tone={tone}>{word}</b>
              <span className="how">{TRIGGER[check.trigger]}</span>
            </span>
            {check.change && <p>{check.change.sentence}</p>}
            {check.problem && <p>{check.problem}</p>}
          </button>
        );
      })}
      {!watch.checks.length && <p className="feed-empty">No checks yet. The first one is made at {clock(watch.nextAt)}.</p>}
    </div>
  );
}
