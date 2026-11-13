// Folds a coworker's public events into the rows a thread draws under its message. The
// page folds the live stream; the server folds the same events once more when a job
// ends, to keep its steps after the Computer stops. It reads only typed fields the
// Computer sends; how a step is worded for the page is in ./steps.

import type { Outcome, WireEvent } from "./events";

export type Item =
  /** `shot`: the last picture of the screen the step left (see WireEvent.frame). */
  | { kind: "step"; id: string; title: string; state: string; type: string; url?: string; page?: string; shot?: string; at: number }
  /** What the coworker says it is doing. */
  | { kind: "note"; id: string; text: string; at: number }
  /** A message the person sent while it worked. */
  | { kind: "steer"; id: string; text: string; at: number }
  /** The controls changed hands: human, agent or locked. */
  | { kind: "control"; id: string; who: string; at: number };

export interface Work {
  turnId: string;
  items: Item[];
  startedAt: number;
  outcome?: Outcome & { at: number };
}

/** Events in, each turn's work out. Replaying an event already folded changes nothing. */
export function fold(events: readonly WireEvent[]): Map<string, Work> {
  const turns = new Map<string, Work>();
  const steps = new Map<string, Extract<Item, { kind: "step" }>>();
  const seen = new Set<number>();
  let current: Work | undefined;

  const workFor = (event: WireEvent): Work => {
    // An event without a turn (an older record) belongs to the turn in progress.
    const id = event.turnId || current?.turnId || `turn-${event.id}`;
    let work = turns.get(id);
    if (!work) turns.set(id, (work = { turnId: id, items: [], startedAt: event.at }));
    return (current = work);
  };

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const id = `e${event.id}`;

    if (event.input) {
      const work = workFor(event);
      if (event.input.kind === "steer") work.items.push({ kind: "steer", id, text: event.input.text, at: event.at });
      else work.startedAt = event.at;
    } else if (event.progress) {
      workFor(event).items.push({ kind: "note", id, text: event.progress.text, at: event.at });
    } else if (event.step) {
      // A step is sent when it starts and again when it ends: one row, updated.
      const { id: stepId, title, state, kind, url, page } = event.step;
      const known = steps.get(stepId);
      if (known) Object.assign(known, { title, state, url: url ?? known.url, page: page ?? known.page });
      else {
        const item = { kind: "step" as const, id: stepId, title, state, type: kind, url, page, at: event.at };
        steps.set(stepId, item);
        workFor(event).items.push(item);
      }
    } else if (event.frame) {
      // A picture belongs to the step it names, or else to the latest step of its turn.
      const owner = (event.frame.stepId && steps.get(event.frame.stepId)) || turns.get(event.turnId)?.items.findLast((item) => item.kind === "step");
      if (owner?.kind === "step") owner.shot = event.frame.src;
    } else if (event.controller) {
      current?.items.push({ kind: "control", id, who: event.controller, at: event.at });
    } else if (event.outcome) {
      workFor(event).outcome = { ...event.outcome, at: event.at };
    }
  }
  return turns;
}
