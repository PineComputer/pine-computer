// Folds the agent's public events into turns the page can draw. It reads only typed
// fields the Computer sends (a step's kind, state, title and facts) and never parses
// the words: titles and notes are shown as written.

import { brand } from "@/brand";
import type { Outcome, Step, WireEvent } from "@/shared/events";

export interface Frame {
  id: number;
  src: string;
}

export type Item =
  | { kind: "note"; id: string; text: string; at: number }
  | { kind: "step"; id: string; step: Step; at: number; endedAt?: number; frames: Frame[] }
  | { kind: "steer"; id: string; text: string; at: number }
  | { kind: "control"; id: string; text: string; at: number };

export interface Turn {
  id: string;
  /** What started it: your task, or your answer to its question. */
  ask?: { kind: string; text: string; at: number };
  items: Item[];
  outcome?: Outcome & { at: number };
  startedAt: number;
  lastAt: number;
}

const CONTROL_WORDS: Record<string, string> = {
  human: "You took the controls",
  agent: `Handed back to ${brand.agent}`,
  locked: "Controls locked: the desktop couldn’t be confirmed",
};

/** Events in, turns out, oldest first. Replaying an event already folded changes nothing. */
export function fold(events: readonly WireEvent[]): Turn[] {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  const steps = new Map<string, Extract<Item, { kind: "step" }>>();
  const seen = new Set<number>();
  let current: Turn | undefined;

  const turnFor = (event: WireEvent): Turn => {
    // An event without a turn (an older record) belongs to the turn in progress.
    const id = event.turnId || current?.id || `turn-${event.id}`;
    let turn = byId.get(id);
    if (!turn) {
      turn = { id, items: [], startedAt: event.at, lastAt: event.at };
      byId.set(id, turn);
      turns.push(turn);
    }
    turn.lastAt = Math.max(turn.lastAt, event.at);
    current = turn;
    return turn;
  };

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (event.input) {
      const turn = turnFor(event);
      if (event.input.kind === "steer") {
        turn.items.push({ kind: "steer", id: `e${event.id}`, text: event.input.text, at: event.at });
      } else {
        turn.ask = { kind: event.input.kind, text: event.input.text, at: event.at };
        turn.startedAt = event.at;
      }
    } else if (event.progress) {
      turnFor(event).items.push({ kind: "note", id: `e${event.id}`, text: event.progress.text, at: event.at });
    } else if (event.step) {
      // A step is sent when it starts and again when it ends: one row, updated.
      const known = steps.get(event.step.id);
      if (known) {
        known.step = event.step;
        if (event.step.state !== "running") known.endedAt = event.at;
        turnFor(event);
      } else {
        const item: Extract<Item, { kind: "step" }> = {
          kind: "step",
          id: event.step.id,
          step: event.step,
          at: event.at,
          ...(event.step.state === "running" ? {} : { endedAt: event.at }),
          frames: [],
        };
        steps.set(event.step.id, item);
        turnFor(event).items.push(item);
      }
    } else if (event.frame) {
      const owner = event.frame.stepId ? steps.get(event.frame.stepId) : undefined;
      owner?.frames.push({ id: event.id, src: event.frame.src });
    } else if (event.controller) {
      const text = CONTROL_WORDS[event.controller];
      if (text && current) current.items.push({ kind: "control", id: `e${event.id}`, text, at: event.at });
    } else if (event.outcome) {
      turnFor(event).outcome = { ...event.outcome, at: event.at };
    }
  }
  return turns;
}

// ---- how a turn reads -------------------------------------------------------

/** A turn reads as its work, with the agent's notes inside it; only a steer breaks it. */
export type Piece =
  | { kind: "work"; items: Item[]; since: number }
  | { kind: "note"; item: Extract<Item, { kind: "note" }> }
  | { kind: "steer"; item: Extract<Item, { kind: "steer" }> };

export function pieces(turn: Turn): Piece[] {
  const out: Piece[] = [];
  let since = turn.startedAt;
  for (const item of turn.items) {
    if (item.kind === "steer") {
      out.push({ kind: "steer", item });
      since = item.at;
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "work") last.items.push(item);
    else out.push({ kind: "work", items: [item], since });
  }
  // Notes with no work beside them have nothing to fold: they stand alone.
  return out.flatMap((piece): Piece[] =>
    piece.kind === "work" && piece.items.every((item) => item.kind === "note")
      ? piece.items.map((item) => ({ kind: "note", item: item as Extract<Item, { kind: "note" }> }))
      : [piece],
  );
}

/** One line of a visit: an action in the Computer's words, and how many times in a row. */
export interface Action {
  text: string;
  state: string;
  times: number;
}

export type Row =
  | { kind: "visit"; key: string; title: string; url?: string; site?: string; actions: Action[]; state: string; at: number; frame?: Frame; continued: boolean; stepIds: string[] }
  | { kind: "step"; item: Extract<Item, { kind: "step" }> }
  | { kind: "note"; item: Extract<Item, { kind: "note" }> }
  | { kind: "control"; item: Extract<Item, { kind: "control" }> };

const siteOf = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

/**
 * Consecutive browser steps that ended on one page (its title and address alike) are
 * one visit to it. A visit a note interrupts goes on without naming its page again.
 */
export function rows(items: readonly Item[]): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    if (item.kind === "note" || item.kind === "control") {
      out.push({ kind: item.kind, item } as Row);
      continue;
    }
    if (item.kind !== "step") continue;
    const page = item.step.kind === "browser" ? item.step.facts?.page : undefined;
    if (!page?.url && !page?.title) {
      out.push({ kind: "step", item });
      continue;
    }
    const key = `${page.url ?? ""} ${page.title ?? ""}`;
    const said = item.step.facts?.steps?.length ? item.step.facts.steps : [item.step.title];
    const actions = said.map((text, i) => ({ text, state: i === said.length - 1 ? item.step.state : "completed", times: 1 }));
    const frame = item.frames[item.frames.length - 1];

    const last = out[out.length - 1];
    if (last?.kind === "visit" && last.key === key) {
      append(last, actions, item, frame);
      continue;
    }
    let i = out.length - 1;
    while (i >= 0 && (out[i].kind === "note" || out[i].kind === "control")) i -= 1;
    const before = out[i];
    const continued = i < out.length - 1 && before?.kind === "visit" && before.key === key;
    const visit: Extract<Row, { kind: "visit" }> = {
      kind: "visit",
      key,
      title: page.title || siteOf(page.url) || "A page",
      url: page.url,
      site: page.title ? siteOf(page.url) : undefined,
      actions: [],
      state: item.step.state,
      at: item.at,
      continued,
      stepIds: [],
    };
    append(visit, actions, item, frame);
    out.push(visit);
  }
  return out;
}

function append(visit: Extract<Row, { kind: "visit" }>, actions: Action[], item: Extract<Item, { kind: "step" }>, frame?: Frame) {
  for (const action of actions) {
    // The same action again, ending the same way, is said once with a count.
    const last = visit.actions[visit.actions.length - 1];
    if (last && last.text === action.text && last.state === action.state) last.times += 1;
    else visit.actions.push({ ...action });
  }
  visit.state = item.step.state;
  visit.stepIds.push(item.id);
  if (frame) visit.frame = frame;
}

/** What a part of the work did, in the kinds the Computer gave its steps. */
export function tally(list: readonly Row[]): string {
  const pages = new Set<string>();
  let commands = 0;
  let files = 0;
  let other = 0;
  for (const row of list) {
    if (row.kind === "visit") pages.add(row.key);
    else if (row.kind === "step") {
      if (row.item.step.kind === "command") commands += 1;
      else if (row.item.step.kind === "file") files += 1;
      else other += 1;
    }
  }
  const n = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;
  const parts = [pages.size && n(pages.size, "page"), commands && n(commands, "command"), files && n(files, "file")].filter(
    (part): part is string => Boolean(part),
  );
  if (other) parts.push(parts.length ? n(other, "other step") : n(other, "step"));
  return parts.join(" · ");
}

/** The screens a part of the work left, one per page visited and each other step's last. */
export function film(list: readonly Row[]): { frame: Frame; title: string }[] {
  const out: { frame: Frame; title: string }[] = [];
  let page: number | null = null;
  for (const row of list) {
    if (row.kind === "visit") {
      const shot = row.frame ? { frame: row.frame, title: row.title } : null;
      if (row.continued && page !== null) {
        if (shot) out[page] = shot;
      } else if (shot) page = out.push(shot) - 1;
      else page = null;
    } else if (row.kind === "step") {
      const frame = row.item.frames[row.item.frames.length - 1];
      if (frame) out.push({ frame, title: row.item.step.title });
    }
  }
  return out;
}
