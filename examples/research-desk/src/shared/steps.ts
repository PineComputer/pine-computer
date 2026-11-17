// How a reader's steps read on the page. The Computer titles each step in the
// imperative ("Open a page", "Run sleep 5"); the desk says what was done ("Opened
// docs.deno.com", "Ran a command") and never shows a command or a path.

import type { Item, StepItem } from "./fold";

/** What a step did, in words; the page it was on in `quiet`. */
export interface Said {
  text: string;
  quiet?: string;
}

// Past and present forms of the verbs the Computer opens a title with. A title that
// starts with any other word is shown as it was written.
const IRREGULAR: Record<string, [string, string]> = {
  Read: ["Read", "Reading"],
  Run: ["Ran", "Running"],
  Write: ["Wrote", "Writing"],
  Go: ["Went", "Going"],
  Take: ["Took", "Taking"],
  Find: ["Found", "Finding"],
  Make: ["Made", "Making"],
  Set: ["Set", "Setting"],
  Get: ["Got", "Getting"],
  Choose: ["Chose", "Choosing"],
  Stop: ["Stopped", "Stopping"],
  Copy: ["Copied", "Copying"],
  Verify: ["Verified", "Verifying"],
};
const REGULAR = new Set(
  "Open Wait Click Fill Type Select Check Scroll Press Hover Navigate Close Switch List Search Create Edit Delete Move Save Download Use Look Enter Focus View Load Extract Add Remove Update Review Inspect Capture Expand Show Start Reload Dismiss Accept Fetch Visit Zoom".split(" "),
);

function reword(title: string, running: boolean): string {
  const [verb, ...rest] = title.split(" ");
  const known = IRREGULAR[verb] ?? (REGULAR.has(verb) ? (verb.endsWith("e") ? [`${verb}d`, `${verb.slice(0, -1)}ing`] : [`${verb}ed`, `${verb}ing`]) : null);
  return known ? [known[running ? 1 : 0], ...rest].join(" ") : title;
}

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const PAGE = /\b(?:a|the) page\b/;

/** One step, said as work: done, or under way while it runs. */
export function say(step: StepItem, live = false): Said {
  const running = live && step.state === "running";
  if (step.type === "command") return { text: running ? "Running a command" : "Ran a command" };
  if (step.type === "file") return { text: running ? "Writing its notes" : "Wrote its notes" };
  const text = reword(step.title, running);
  const host = step.type === "browser" ? hostOf(step.url) : "";
  if (!host) return { text };
  // "Open a page" names no page: the site it ended on does, and the page's title says which.
  return PAGE.test(text) ? { text: text.replace(PAGE, host), quiet: step.page || undefined } : { text, quiet: host };
}

export const stepsIn = (items: readonly Item[]): StepItem[] => items.filter((item): item is StepItem => item.kind === "step");

export type Row = { id: string; kind: "step"; said: Said; state: string; times: number; key: string } | { id: string; kind: "control"; who: string };

/**
 * A run's items as rows: the same step on the same page, several times over, is one
 * row. The reader's own commentary is left out: the steps and the screen say enough.
 */
export function rows(items: readonly Item[], live = false): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    if (item.kind === "note") continue;
    if (item.kind === "control") out.push({ id: item.id, kind: "control", who: item.who });
    else {
      const done = say(item);
      const key = `${done.text}|${done.quiet ?? ""}`;
      const last = out.at(-1);
      if (last?.kind === "step" && last.key === key) Object.assign(last, { times: last.times + 1, state: item.state, said: say(item, live) });
      else out.push({ id: item.id, kind: "step", said: say(item, live), state: item.state, times: 1, key });
    }
  }
  return out;
}

/** What it is doing now, for the line under its screen: "Reading the page". */
export function doing(items: readonly Item[]): string | undefined {
  const step = stepsIn(items).at(-1);
  return step ? say(step, true).text : undefined;
}
