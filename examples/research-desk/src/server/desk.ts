// A brief, from the question to the report. Each stage is a job handed to Pine's agent
// on a reader's Computer, in plain words, with the result asked back as a small file:
//
//   plan   one short run proposes the angles, which the person may edit;
//   read   one run per angle, each on a Computer of its own, all at the same time;
//   write  one last run writes the report from the readers' notes.
//
// Starting a Computer takes a while, so a run is recorded first and launched in the
// background; the page follows its state. A run that can't start yet (the project's
// limit on running Computers, or every reader busy) waits in the queue, and the worker
// launches it when there's room.

import "server-only";
import { randomBytes } from "node:crypto";
import type { Angle, BriefView, Desk, RunView } from "@/shared/api";
import { anglesFrom, cite, jsonIn, notesFrom, reportFrom, type Reading } from "@/shared/notes";
import { stepsIn } from "@/shared/steps";
import { explain, HttpError } from "./http";
import { computerState, ensureComputer, liveName, openSession, session, Waiting } from "./pine";
import { read, update, type BriefRecord, type RunRecord, type StoreData } from "./store";
import { forgetShots, RETURNS, sync } from "./turns";

/** A reader with one of these is taken. */
const BUSY = new Set(["starting", "running", "canceling", "needs_input"]);
const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** What every run carries besides its goal. */
const CONTEXT = [
  "You work at a research desk. A person watches your screen while you work, and what you return is read by software.",
  "- The file you are asked for is the result: valid JSON, in exactly the shape given, with nothing else in it.",
  "- Never ask a question. Decide for yourself and carry on.",
  "- End with one plain sentence saying what you did.",
].join("\n");

// ---- the three jobs, in words -------------------------------------------------------

function planGoal(question: string): string {
  return [
    "A person asked a research desk this question:",
    "",
    `"${question}"`,
    "",
    "Three readers will each research one angle of it on the web at the same time, and their notes become one report. Propose the angles: three, unless the question clearly has only two parts. Each angle is a distinct part of the question that one reader can cover alone from a few primary sources. For a comparison, that is usually one subject per angle.",
    "",
    `Don't open the browser and don't research the question yourself. Save a file named ${RETURNS.plan} in the work directory and return it as a file, in exactly this shape:`,
    "",
    '{"angles":[{"title":"Three to six words","focus":"One or two sentences: what to find out, and which official sources to prefer."}]}',
  ].join("\n");
}

function readGoal(question: string, angle: Angle): string {
  return [
    "You are one of three readers at a research desk, each on a computer of its own. The desk was asked:",
    "",
    `"${question}"`,
    "",
    `Your angle: ${angle.title}`,
    angle.focus,
    "",
    "Research this angle only, in the browser, so the person watching your screen can follow:",
    "- Open primary sources (official documentation and a project's own pages) rather than summaries of them. Go to an address directly when you know it; search only when you don't.",
    "- Read three to five pages properly, scrolling through each one. Stop when you can answer your angle.",
    "- Don't sign in anywhere and don't download anything.",
    "",
    `Then save a file named ${RETURNS.read} in the work directory and return it as a file, in exactly this shape:`,
    "",
    '{"summary":"Two or three sentences answering your angle.","findings":[{"text":"One specific fact, in a sentence.","url":"The exact address of the page it is on."}]}',
    "",
    "Give five to eight findings. Each must come from a page you opened in the browser during this job, cited by that page's address as the address bar showed it. A finding that cites any other page is thrown away.",
  ].join("\n");
}

function writeGoal(question: string, readings: readonly Reading[]): string {
  const { sources, cited } = cite(readings);
  const lines = [
    "Write a short research report that answers this question:",
    "",
    `"${question}"`,
    "",
    "Readers each took one angle and read the web for it. Their notes follow. Every finding ends with the number of the page it came from.",
  ];
  for (const part of cited) {
    lines.push("", `Angle ${part.angle.id}: ${part.angle.title}`);
    if (part.summary) lines.push(`Summary: ${part.summary}`);
    for (const finding of part.findings) lines.push(`- ${finding.text} [${finding.n}]`);
    if (!part.findings.length) lines.push("- (this reader brought back nothing that could be used)");
  }
  lines.push("", "The pages:");
  for (const source of sources) lines.push(`[${source.n}] ${source.title} (${source.host})`);
  lines.push(
    "",
    "Write from these notes only: don't open the browser, and add no fact that isn't in them. After each claim, cite the page it came from with its number in square brackets, like [2]. Use no other numbers in brackets.",
    "",
    `Save a file named ${RETURNS.write} in the work directory and return it as a file, in exactly this shape:`,
    "",
    '{"title":"The report\'s title, under ten words","answer":"The short answer to the question: two or three sentences, with citations.","sections":[{"angle":"a1","body":"80 to 130 words of Markdown for this angle, with citations. No heading."}]}',
    "",
    "Give one section per angle that has findings, in the order above, with the angle's id.",
  );
  return lines.join("\n");
}

// ---- what the page reads -------------------------------------------------------------

const readerName = (data: StoreData, id: string) => data.readers.find((r) => r.id === id)?.name ?? "A reader";

function runView(data: StoreData, run: RunRecord): RunView {
  const ended = run.items !== undefined;
  return {
    id: run.id,
    kind: run.kind,
    angle: run.angle,
    reader: run.reader,
    state: run.state,
    waiting: run.waiting,
    question: run.state === "needs_input" ? run.summary : undefined,
    problem: ended && run.state !== "completed" ? run.summary : undefined,
    live: liveName(data, run.id),
    driving: data.readers.some((r) => r.session?.run === run.id && r.driving === true),
    items: run.items,
    pages: run.pages?.length,
    dropped: run.dropped,
    lastShot: stepsIn(run.items ?? []).findLast((step) => step.shot)?.shot,
  };
}

const summary = (brief: BriefRecord) => ({ id: brief.id, question: brief.question, createdAt: brief.createdAt, state: brief.state, title: brief.report?.title, sources: brief.report?.sources.length });

export async function desk(): Promise<Desk> {
  const data = await read();
  return {
    briefs: data.briefs.map(summary).reverse(),
    readers: data.readers.map((r) => ({ id: r.id, name: r.name, computer: computerState(r), expiresAt: r.computer?.expiresAt, busy: data.runs.some((run) => run.reader === r.id && BUSY.has(run.state)) })),
  };
}

function briefIn(data: StoreData, id: string): BriefRecord {
  const brief = data.briefs.find((b) => b.id === id);
  if (!brief) throw new HttpError(404, "That brief isn't on this desk.");
  return brief;
}

/** The runs a brief shows: its readers' latest, and whichever run is planning or writing. */
function shown(data: StoreData, brief: BriefRecord): RunRecord[] {
  const runs = data.runs.filter((r) => r.brief === brief.id);
  const reads = brief.angles.map((a) => runs.findLast((r) => r.kind === "read" && r.angle === a.id)).filter((r): r is RunRecord => Boolean(r));
  const other = brief.state === "planning" ? runs.findLast((r) => r.kind === "plan") : brief.state === "writing" || brief.state === "failed" ? runs.findLast((r) => r.kind === "write") : undefined;
  return other ? [...reads, other] : reads;
}

export async function briefView(id: string): Promise<BriefView> {
  const data = await read();
  const brief = briefIn(data, id);
  return { ...summary(brief), angles: brief.angles, problem: brief.problem, report: brief.report, runs: shown(data, brief).map((run) => runView(data, run)) };
}

// ---- asking ---------------------------------------------------------------------------

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Records a question as a brief and has a reader propose its angles. The same key again changes nothing. */
export async function ask(question: string, key: string): Promise<string> {
  if (!KEY.test(key)) throw new HttpError(400, "Send the brief's key.");
  const id = `b-${key.slice(0, 12)}`;
  const run = newId("p");
  const fresh = await update((data) => {
    if (data.briefs.some((b) => b.id === id)) return false;
    data.briefs.push({ id, question, createdAt: new Date().toISOString(), state: "planning", angles: [] });
    data.runs.push({ id: run, brief: id, kind: "plan", reader: "r1", goal: planGoal(question), askedAt: new Date().toISOString(), state: "starting" });
    return true;
  });
  if (fresh) {
    launch(run);
    // The other readers start their Computers now, so they are up when the angles are agreed.
    for (const reader of (await read()).readers.slice(1)) void ensureComputer(reader.id).catch(() => undefined);
  }
  return id;
}

/** Puts a reader on each angle, all at once. */
export async function start(id: string, angles: Angle[]): Promise<void> {
  const clean = angles.map((a, i) => ({ id: `a${i + 1}`, title: a.title?.trim().slice(0, 80) ?? "", focus: a.focus?.trim().slice(0, 400) ?? "" })).filter((a) => a.title);
  if (clean.length < 2 || clean.length > 3) throw new HttpError(400, "A brief has two or three angles.");
  const runs = await update((data) => {
    const brief = briefIn(data, id);
    if (brief.state !== "draft") throw new HttpError(409, "This brief has already started.");
    Object.assign(brief, { angles: clean, state: "reading", problem: undefined });
    return clean.map((angle, i) => {
      const run: RunRecord = { id: newId("r"), brief: id, kind: "read", angle: angle.id, reader: data.readers[i].id, goal: readGoal(brief.question, angle), askedAt: new Date().toISOString(), state: "starting" };
      data.runs.push(run);
      return run.id;
    });
  });
  runs.forEach(launch);
}

/** Stops a brief where it is: its runs are canceled and what they had opened is kept. */
export async function halt(id: string): Promise<void> {
  const data = await read();
  const brief = briefIn(data, id);
  if (brief.state === "done" || brief.state === "failed") return;
  for (const run of data.runs.filter((r) => r.brief === id && BUSY.has(r.state) && r.turnId)) {
    await (await session(run.id))?.agent.cancel(run.turnId!).catch(() => undefined);
  }
  await update((next) => {
    Object.assign(briefIn(next, id), { state: "failed", problem: "You stopped this brief." });
    for (const run of next.runs) {
      // The worker records a canceled turn like any other that ended.
      if (run.brief === id && run.turnId && BUSY.has(run.state)) run.state = "canceling";
      if (run.brief === id && !run.turnId && (run.state === "starting" || run.state === "queued")) Object.assign(run, { state: "canceled", waiting: undefined, endedAt: new Date().toISOString(), items: [] });
    }
  });
}

/** Has the report written again from the notes the readers brought back. */
export async function rewrite(id: string): Promise<void> {
  await update((data) => {
    const brief = briefIn(data, id);
    if (brief.state !== "failed" || !data.runs.some((r) => r.brief === id && r.kind === "read" && r.notes)) throw new HttpError(409, "There are no notes to write this report from.");
    Object.assign(brief, { state: "reading", problem: undefined });
  });
  await advance(id);
}

export async function forget(id: string): Promise<void> {
  await halt(id);
  const runs = await update((data) => {
    briefIn(data, id);
    const gone = data.runs.filter((r) => r.brief === id).map((r) => r.id);
    data.briefs = data.briefs.filter((b) => b.id !== id);
    data.runs = data.runs.filter((r) => r.brief !== id);
    return gone;
  });
  await forgetShots(runs);
}

/** Answers the question a run stopped on. The reply opens the next turn, which carries the same run on. */
export async function answer(id: string, text: string): Promise<void> {
  const run = (await read()).runs.find((r) => r.id === id);
  const target = await session(id);
  if (!run?.turnId || run.state !== "needs_input" || !target) throw new HttpError(409, "That question has moved on.");
  // The same answer again returns the same new turn.
  const opened = await target.agent.answer(run.turnId, text);
  await update((data) => {
    const record = data.runs.find((r) => r.id === id);
    if (record) Object.assign(record, { turnId: opened.turnId, state: opened.state, summary: undefined });
  });
}

// ---- launching ------------------------------------------------------------------------

// One launch per run at a time, whether a route or the worker asks.
const shared = globalThis as typeof globalThis & { __launching?: Set<string> };
const launching = (shared.__launching ??= new Set());

/** Starts a recorded run on a reader's Computer, in the background. */
export function launch(run: string): void {
  if (launching.has(run)) return;
  launching.add(run);
  void begin(run)
    .catch((error) => console.error("launch:", error))
    .finally(() => launching.delete(run));
}

const waitingToStart = (data: StoreData, id: string) => data.runs.find((r) => r.id === id && (r.state === "starting" || r.state === "queued"));

/**
 * Gives the run a reader nobody else is using: one whose Computer is already running
 * if there is one (a queued angle takes over from a reader that has finished), or else
 * its own. Decided inside one change to the records, so two runs never get the same reader.
 */
function seat(id: string): Promise<string> {
  return update((data) => {
    const run = waitingToStart(data, id);
    if (!run) throw new Waiting("");
    const free = data.readers.filter((reader) => !data.runs.some((other) => other.id !== id && other.reader === reader.id && BUSY.has(other.state)));
    const rank = (reader: (typeof free)[number]) => (reader.computer?.binding ? 0 : 2) + (reader.id === run.reader ? 0 : 1);
    const reader = free.sort((a, b) => rank(a) - rank(b))[0];
    if (!reader) throw new Waiting("All three readers are busy. This starts when one of them finishes.");
    Object.assign(run, { reader: reader.id, state: "starting" });
    return reader.id;
  });
}

async function begin(id: string): Promise<void> {
  try {
    const reader = await seat(id);
    const found = await ensureComputer(reader);
    const target = await openSession(found, reader, id);
    const run = waitingToStart(await read(), id);
    if (!run) return; // stopped while its Computer started
    // The run's id names the submission: sent again (after a lost response, or by the
    // worker after a restart) it returns the turn it started instead of starting another.
    const turn = await target.agent.run(run.goal, { idempotencyKey: id, context: CONTEXT });
    await update((next) => {
      const record = next.runs.find((r) => r.id === id);
      if (record) Object.assign(record, { turnId: turn.turnId, state: turn.state, waiting: undefined });
    });
  } catch (error) {
    const waiting = error instanceof Waiting ? error.message : null;
    const said = waiting ?? explain(error).error;
    const brief = await update((next) => {
      const record = waitingToStart(next, id);
      if (!record) return undefined;
      if (waiting !== null) Object.assign(record, { state: "queued", waiting });
      else Object.assign(record, { state: "failed", summary: said, endedAt: new Date().toISOString(), items: [] });
      return record.brief;
    });
    if (brief && waiting === null) await advance(brief);
  }
}

/** Waits a while for a run's turn to end, records it, and moves its brief on. */
export async function follow(run: RunRecord): Promise<void> {
  await sync(run.id, 25_000);
  await advance(run.brief);
}

// ---- moving a brief on ----------------------------------------------------------------

/** A brief's readers, as the sources are built from them: the latest run on each angle. */
function readings(data: StoreData, brief: BriefRecord): { runs: RunRecord[]; readings: Reading[] } {
  const runs = brief.angles.map((a) => data.runs.findLast((r) => r.brief === brief.id && r.kind === "read" && r.angle === a.id)).filter((r): r is RunRecord => Boolean(r));
  return { runs, readings: runs.map((run) => ({ run: run.id, reader: run.reader, angle: brief.angles.find((a) => a.id === run.angle)!, pages: run.pages ?? [], notes: run.notes })) };
}

/**
 * Looks at what a brief's runs have brought back and takes its next step: the angles
 * once the planner is done, the writer once every reader is, the report once the writer
 * is. Safe to call at any time, any number of times.
 */
export async function advance(id: string): Promise<void> {
  const next = await update((data) => {
    const brief = data.briefs.find((b) => b.id === id);
    if (!brief) return undefined;
    const latest = (kind: RunRecord["kind"]) => data.runs.findLast((r) => r.brief === id && r.kind === kind);
    const result = (run: RunRecord) => jsonIn(run.returned ?? "") ?? jsonIn(run.summary ?? "");

    if (brief.state === "planning") {
      const plan = latest("plan");
      if (!plan?.items) return undefined;
      brief.angles = anglesFrom(result(plan));
      brief.state = "draft";
      // The person can still write the angles themselves.
      if (brief.angles.length < 2) Object.assign(brief, { angles: [], problem: "No angles came back. Write two or three yourself." });
    } else if (brief.state === "reading") {
      const { runs } = readings(data, brief);
      if (runs.length < brief.angles.length || runs.some((r) => !r.items)) return undefined;
      for (const run of runs) run.notes ??= run.state === "completed" ? notesFrom(result(run)) : undefined;
      const built = readings(data, brief).readings;
      const { sources, cited } = cite(built);
      runs.forEach((run, i) => (run.dropped = cited[i].dropped));
      if (!sources.length) return void Object.assign(brief, { state: "failed", problem: "No reader brought back a finding from a page it opened, so there is nothing to write from." });
      brief.state = "writing";
      const run: RunRecord = { id: newId("w"), brief: id, kind: "write", reader: runs[0].reader, goal: writeGoal(brief.question, built), askedAt: new Date().toISOString(), state: "starting" };
      data.runs.push(run);
      return run.id;
    } else if (brief.state === "writing") {
      const write = latest("write");
      if (!write?.items) return undefined;
      const report = write.state === "completed" ? reportFrom(result(write), brief.angles, cite(readings(data, brief).readings).sources) : undefined;
      if (report) Object.assign(brief, { state: "done", report, problem: undefined });
      else Object.assign(brief, { state: "failed", problem: "The report didn't come back in a form the desk can use. The readers' notes are kept: have it written again." });
    }
    return undefined;
  });
  if (next) launch(next);
}
