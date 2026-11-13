// How a coworker's steps read on the page. The Computer titles each step in the
// imperative ("Open a page", "Run sleep 5"); a thread says what was done ("Opened
// news.ycombinator.com", "Ran a command"), folds a run of the same step into one row
// ("Opened 5 pages"), and keeps the pictures of the screen the steps left as a trail.

import type { Item } from "./fold";

export type StepItem = Extract<Item, { kind: "step" }>;

/** What a step did, in words; a command or a file name in `mono`; the site it was on in `quiet`. */
export interface Said {
  text: string;
  mono?: string;
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
  Send: ["Sent", "Sending"],
  Set: ["Set", "Setting"],
  Get: ["Got", "Getting"],
  Build: ["Built", "Building"],
  Choose: ["Chose", "Choosing"],
  Stop: ["Stopped", "Stopping"],
  Drag: ["Dragged", "Dragging"],
  Drop: ["Dropped", "Dropping"],
  Submit: ["Submitted", "Submitting"],
  Log: ["Logged", "Logging"],
  Copy: ["Copied", "Copying"],
  Verify: ["Verified", "Verifying"],
};
const REGULAR = new Set(
  "Open Wait Click Fill Type Select Check Uncheck Scroll Press Hover Navigate Close Switch List Search Create Edit Delete Move Rename Save Download Upload Use Look Sign Enter Focus Clear View Load Install Extract Convert Generate Add Remove Update Review Inspect Capture Toggle Expand Collapse Paste Attach Show Start Reload Dismiss Accept Call Fetch Visit Zoom".split(
    " ",
  ),
);

function forms(verb: string): [string, string] | null {
  if (IRREGULAR[verb]) return IRREGULAR[verb];
  if (!REGULAR.has(verb)) return null;
  return verb.endsWith("e") ? [`${verb}d`, `${verb.slice(0, -1)}ing`] : [`${verb}ed`, `${verb}ing`];
}

function reword(title: string, running: boolean): string {
  const [verb, ...rest] = title.split(" ");
  const known = forms(verb);
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

const isRun = (step: StepItem) => step.type === "command" && /^Run(\s|$)/.test(step.title);
const PAGE = /\b(?:a|the) page\b/;

/** One step, said as work: done, or under way while it runs. */
export function say(step: StepItem, live = false): Said {
  const running = live && step.state === "running";
  if (isRun(step)) {
    const command = step.title.slice(3).trim();
    return { text: running ? "Running a command" : "Ran a command", mono: command || undefined };
  }
  const text = reword(step.title, running);
  const host = step.type === "browser" ? hostOf(step.url) : "";
  if (!host) return { text };
  // "Open a page" names no page: the site it ended on does, and the page's title says which.
  return PAGE.test(text) ? { text: text.replace(PAGE, host), quiet: step.page || undefined } : { text, quiet: host };
}

// ---- a job's steps, folded --------------------------------------------------------

export type Row =
  | { kind: "steps"; id: string; said: Said; steps: StepItem[]; failed: number; at: number }
  | { kind: "note"; item: Extract<Item, { kind: "note" }> }
  | { kind: "steer"; item: Extract<Item, { kind: "steer" }> }
  | { kind: "control"; item: Extract<Item, { kind: "control" }> };

/** How a run of the same step reads; any other title is said once with its count. */
const MANY: Record<string, (n: number) => string> = {
  "Open a page": (n) => `Opened ${n} pages`,
  "Read the page": (n) => `Read ${n} pages`,
  "Wait for the page": (n) => `Waited for the page ${n} times`,
  "Read a file": (n) => `Read ${n} files`,
  "List files": (n) => `Listed files ${n} times`,
  "Search files": (n) => `Searched files ${n} times`,
};

const sameStep = (step: StepItem) => `${step.type} ${isRun(step) ? "Run" : step.title}`;

function saidMany(steps: StepItem[]): Said {
  const first = steps[0];
  const n = steps.length;
  if (isRun(first)) return { text: `Ran ${n} commands` };
  const hosts = [...new Set(steps.map((step) => hostOf(step.url)).filter(Boolean))];
  const quiet = hosts.length > 3 ? `${hosts.slice(0, 3).join(", ")} and ${hosts.length - 3} more` : hosts.join(", ");
  const text = MANY[first.title]?.(n) ?? `${reword(first.title, false)}, ${n} times`;
  return { text, quiet: quiet || undefined };
}

/** A job's items as rows: consecutive steps of the same kind are one row. */
export function rows(items: readonly Item[]): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    if (item.kind !== "step") {
      out.push({ kind: item.kind, item } as Row);
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === "steps" && sameStep(last.steps[0]) === sameStep(item)) last.steps.push(item);
    else out.push({ kind: "steps", id: item.id, said: say(item), steps: [item], failed: 0, at: item.at });
  }
  for (const row of out) {
    if (row.kind !== "steps") continue;
    row.failed = row.steps.filter((step) => step.state === "failed").length;
    if (row.steps.length > 1) row.said = saidMany(row.steps);
  }
  return out;
}

export const stepsIn = (items: readonly Item[]): StepItem[] => items.filter((item): item is StepItem => item.kind === "step");

/** "12 steps", for the line a finished job settles into. */
export function stepCount(items: readonly Item[]): string {
  const n = stepsIn(items).length;
  return `${n} ${n === 1 ? "step" : "steps"}`;
}

/** What it is doing now, for the line above its screen: "Reading news.ycombinator.com". */
export function doing(items: readonly Item[]): string | undefined {
  const step = stepsIn(items).at(-1);
  if (!step) return undefined;
  const said = say(step, true);
  const host = step.type === "browser" ? hostOf(step.url) : "";
  return host && !said.text.includes(host) ? `${said.text} on ${host}` : said.text;
}

// ---- the trail ---------------------------------------------------------------------

/** A screen a job left behind: the picture, what the step was, and when. */
export interface Shot {
  id: string;
  src: string;
  caption: string;
  at: number;
}

/**
 * The screens a job's steps left, oldest first. A step that only read or waited on the
 * page the last picture already shows replaces that picture instead of adding one.
 */
export function trail(items: readonly Item[]): Shot[] {
  const out: (Shot & { url?: string })[] = [];
  for (const step of stepsIn(items)) {
    // A command or a file changes nothing on the screen worth keeping.
    if (!step.shot || step.type === "command" || step.type === "file") continue;
    const last = out.at(-1);
    if (last && step.url && last.url === step.url && PAGE.test(step.title) && !step.title.startsWith("Open")) {
      last.src = step.shot;
      continue;
    }
    const said = say(step);
    out.push({ id: step.id, src: step.shot, caption: said.text, at: step.at, url: step.url });
  }
  return out;
}
