// Folds a coworker's public events into the rows a thread draws under its message. The
// page folds the live stream; the server folds the same events once more when a job
// ends, to keep its steps after the Computer stops. It reads only typed fields the
// Computer sends and never parses the words: titles and notes are shown as written.

import type { Outcome, WireEvent } from "./events";

export type Item =
  | { kind: "step"; id: string; title: string; state: string; type: string; url?: string; at: number }
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
      const { id: stepId, title, state, kind, url } = event.step;
      const known = steps.get(stepId);
      if (known) Object.assign(known, { title, state, url: url ?? known.url });
      else {
        const item = { kind: "step" as const, id: stepId, title, state, type: kind, url, at: event.at };
        steps.set(stepId, item);
        workFor(event).items.push(item);
      }
    } else if (event.controller) {
      current?.items.push({ kind: "control", id, who: event.controller, at: event.at });
    } else if (event.outcome) {
      workFor(event).outcome = { ...event.outcome, at: event.at };
    }
  }
  return turns;
}

/** "12 steps", for the line a finished job settles into. */
export function stepCount(items: readonly Item[]): string {
  const n = items.filter((item) => item.kind === "step").length;
  return `${n} ${n === 1 ? "step" : "steps"}`;
}

/** The latest thing it said or did, for the line beside a working coworker. */
export function latest(items: readonly Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind === "step") return item.title;
    if (item.kind === "note") return item.text;
  }
  return undefined;
}
