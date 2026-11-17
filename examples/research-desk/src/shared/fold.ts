// Folds a reader's public events into the rows drawn beside its screen. The page folds
// the live stream; the server folds the same events once more when a run ends, to keep
// its steps and the screens of the pages it opened after the Computer stops.

import type { WireEvent } from "./events";

export type Item =
  /** `shot`: the first picture of the screen the step left. */
  | { kind: "step"; id: string; title: string; state: string; type: string; url?: string; page?: string; shot?: string; at: number }
  /** What the reader says it is doing. */
  | { kind: "note"; id: string; text: string; at: number }
  /** The controls changed hands: human, agent or locked. */
  | { kind: "control"; id: string; who: string; at: number };

export type StepItem = Extract<Item, { kind: "step" }>;

/** Events in, one run's work out. Replaying an event already folded changes nothing. */
export function fold(events: readonly WireEvent[]): Item[] {
  const items: Item[] = [];
  const steps = new Map<string, StepItem>();
  const seen = new Set<number>();

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const id = `e${event.id}`;

    if (event.progress) {
      items.push({ kind: "note", id, text: event.progress.text, at: event.at });
    } else if (event.step) {
      // A step is sent when it starts and again when it ends: one row, updated.
      const { id: stepId, title, state, kind, url, page } = event.step;
      const known = steps.get(stepId);
      if (known) Object.assign(known, { title, state, url: url ?? known.url, page: page ?? known.page });
      else {
        const item: StepItem = { kind: "step", id: stepId, title, state, type: kind, url, page, at: event.at };
        steps.set(stepId, item);
        items.push(item);
      }
    } else if (event.frame) {
      // A picture belongs to the step it names, or else to the latest step.
      const owner = (event.frame.stepId && steps.get(event.frame.stepId)) || items.findLast((item): item is StepItem => item.kind === "step");
      if (owner) owner.shot = event.frame.src;
    } else if (event.controller) {
      // The Computer says who drives after every change; only a change is a row.
      const last = items.findLast((item) => item.kind === "control");
      const before = last?.kind === "control" ? last.who : "agent";
      if (event.controller !== before) items.push({ kind: "control", id, who: event.controller, at: event.at });
    }
  }
  return items;
}
