// Questions the agents ask, as reviews the maker works through. A review is created when
// a turn ends with a question and becomes answerable only once that turn's files are
// saved; the maker's decision goes back as one answer to the turn that asked
// (docs/IMPLEMENTATION_PLAN.md, rules 1 to 3).
import type { Decision, FileItem, FileKind, ReviewItem, ReviewKind, Reviewing } from "../shared/types.ts";
import { classify } from "./classify.ts";
import { computerRef, fleet, sessionRef } from "./computers.ts";
import { answerText } from "./decisions.ts";
import { StudioError } from "./errors.ts";
import { all, get, newId, now, run, transaction } from "./db.ts";
import { followTurn, recordTurn } from "./follow.ts";
import { decisionGoal } from "./goals.ts";
import { type FileRow, filesOfStop, toItem, versionNumber } from "./library.ts";
import { publish } from "./live.ts";
import { attach, saveRun, sendRun } from "./runs.ts";
import { type ReviewRow, type SessionRow, type TurnRow, computer as computerRow, episode as episodeRow, episodeCode, review as reviewRow, session as sessionRow } from "./records.ts";

/**
 * What a stop asks the maker for, from the files it returned. In the setup, looks alone are
 * the leads (each one's base look and face, which the skill keeps as a state named face);
 * with places, props or further looks, they are the shared references pre-production made
 * for every episode. An episode asks about its own work, or about a reference the maker let
 * it make that setup didn't (a look the image model refused then). With nothing to look at,
 * it is a question answered in words, whatever its words mention: a review with no items
 * would send an empty decision.
 */
export function inferKind(role: SessionRow["role"], files: (Pick<FileRow, "kind"> & { look?: string | null })[]): ReviewKind {
  const kinds = new Set(files.map((file) => file.kind));
  if (role !== "setup") {
    if (kinds.has("cut")) return "cut";
    if (kinds.has("take")) return "takes";
    if (kinds.has("storyboard")) return "storyboards";
  }
  const further = (look: string | null | undefined) => !!look && look !== "base" && look.toLowerCase() !== "face";
  if (kinds.has("location") || kinds.has("prop") || files.some((file) => file.kind === "look" && further(file.look))) return "references";
  return kinds.has("look") ? "looks" : "question";
}

function lookKey(file: Pick<FileRow, "subject" | "look">): string {
  return !file.look || file.look === "base" ? file.subject ?? "?" : `${file.subject}/${file.look}`;
}

/** Splits a turn's files into the things the maker gives a verdict on, and the rest. */
/** A place or prop as an item of the shared references: a place at another time of day (Night) is an item of its own. */
export function placeKey(file: Pick<FileRow, "kind" | "subject" | "look">): string {
  return `${file.kind}:${file.subject}${file.look ? `/${file.look}` : ""}`;
}

const SEGMENT_PICTURES: FileKind[] = ["storyboard", "blocking", "frame"];

export function itemsOf(kind: ReviewKind, files: FileRow[]): { items: ReviewItem[]; other: FileItem[] } {
  const groups = new Map<string, FileRow[]>();
  const other: FileRow[] = [];
  const add = (key: string, file: FileRow) => groups.set(key, [...(groups.get(key) ?? []), file]);
  for (const file of files) {
    // The handed-over project, its status, lineage and infinite-canvas export, each version's spec and request, and the refusals a stop asks about: for sessions and the studio, not for the maker's eyes.
    if (file.kind === "archive" || file.kind === "status" || file.kind === "lineage" || file.kind === "infinite-canvas" || file.kind === "refusal" || file.kind === "spec" || file.kind === "request" || file.kind === "asset") continue;
    if (kind === "looks" && file.kind === "look") add(lookKey(file), file);
    else if (kind === "references" && file.kind === "look") add(lookKey(file), file);
    else if (kind === "references" && (file.kind === "location" || file.kind === "prop") && file.subject) add(placeKey(file), file);
    // A segment's picture by its path, not the kind it was saved with, so an input crop saved as one before is left out (classify, OUTPUT).
    else if (kind === "storyboards" && SEGMENT_PICTURES.includes(classify(file.rel_path).kind) && file.segment) add(file.segment, file);
    else if (kind === "takes" && file.kind === "take" && file.segment) add(file.segment, file);
    else if (kind === "cut" && file.kind === "cut") add("cut", file);
    else other.push(file);
  }
  // Within an item: storyboards line-art first, then photoreal, then the blocking reference and the first frame; newest versions first.
  const order = (file: FileRow) => (file.kind === "frame" ? 3 : file.kind === "blocking" ? 2 : file.style === "photoreal" ? 1 : 0);
  // Characters first, then places, then props; within each, in natural order.
  const rank = (key: string) => (key.startsWith("location:") ? 1 : key.startsWith("prop:") ? 2 : 0);
  const items = [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, rows]) => ({
      key,
      label: key === "cut" ? "Cut" : key.replace(/^(location|prop):/, ""),
      files: rows.sort((a, b) => order(a) - order(b) || versionNumber(b.version) - versionNumber(a.version)).map(toItem),
    }));
  return { items, other: other.map(toItem) };
}

/** The review the session waits on, if any: its latest stop, not yet decided. */
export function pendingReview(sessionId: string): ReviewRow | undefined {
  return get<ReviewRow>("select * from reviews where session_id = ? and state in ('saving', 'open', 'sending') order by created_at desc limit 1", sessionId);
}

/** A question just ended a turn: record it, not yet answerable. */
export function questionAsked(session: SessionRow, turnId: string, question: string): void {
  run(
    `insert into reviews (id, drama_id, episode_id, session_id, turn_id, kind, state, question, created_at)
     values (?, ?, ?, ?, ?, 'question', 'saving', ?, ?) on conflict(turn_id) do nothing`,
    newId("rev"),
    session.drama_id,
    session.episode_id,
    session.id,
    turnId,
    question,
    now(),
  );
  if (session.episode_id) run("update episodes set state = 'waiting', updated_at = ? where id = ? and state = 'working'", now(), session.episode_id);
  publish(`drama:${session.drama_id}`, "inbox");
}

/** The question's files are saved: it can be answered now, in words when the agent asked in words. */
export function questionReady(session: SessionRow, turnId: string, inWords = false): void {
  const stop = get<ReviewRow>("select * from reviews where turn_id = ?", turnId);
  const kind = inWords || !stop ? "question" : inferKind(session.role, filesOfStop(stop));
  run("update reviews set kind = ?, state = 'open' where turn_id = ? and state = 'saving'", kind, turnId);
  publish(`drama:${session.drama_id}`, "inbox");
}

function subject(review: ReviewRow): string {
  const code = review.episode_id ? episodeCode(episodeRow(review.episode_id)!) : "";
  switch (review.kind) {
    case "looks":
      return "the leads' looks";
    case "references":
      return "the shared references";
    case "storyboards":
      return `${code}'s storyboards`;
    case "takes":
      return `${code}'s takes`;
    case "cut":
      return `${code}'s cut`;
    default:
      return "your question";
  }
}

/** Reviews whose decision this process is sending right now. */
const sending = new Set<string>();

/** Sends the maker's decision as the answer to the turn that asked. */
export async function decide(reviewId: string, decision: Decision): Promise<ReviewRow> {
  if (sending.has(reviewId)) throw new StudioError("decision-sending", "This decision is being sent.", 409);
  sending.add(reviewId);
  try {
    return await send(reviewId, decision);
  } finally {
    sending.delete(reviewId);
  }
}

/** The kinds of review the studio approves for the maker, by what they chose to review (Reviewing). */
const LEFT: Record<Reviewing, ReviewKind[]> = {
  every: [],
  key: ["references", "storyboards", "takes"],
  none: ["looks", "references", "storyboards", "takes", "cut"],
};

/** What the agent is told, and the record keeps, for a step the maker chose not to review. */
const UNREVIEWED = "Approved without review: I chose not to review this step.";

/**
 * Approves every waiting review the maker left to the studio, as the agent stops for it or as
 * they change what they review. A question in words always waits for them; a decision that
 * can't be sent leaves the review open for them too.
 */
export async function approveUnreviewed(dramaId?: string): Promise<void> {
  const waiting = all<ReviewRow & { reviewing: Reviewing }>(
    `select r.*, d.reviewing from reviews r join dramas d on d.id = r.drama_id where r.state = 'open'${dramaId ? " and r.drama_id = ?" : ""} order by r.created_at`,
    ...(dramaId ? [dramaId] : []),
  );
  for (const review of waiting.filter((row) => LEFT[row.reviewing]?.includes(row.kind))) {
    const { items } = itemsOf(review.kind, filesOfStop(review));
    await decide(review.id, { words: UNREVIEWED, items: items.map((item) => ({ key: item.key, verdict: "approve", notes: [] })) }).catch((error) =>
      console.error(`review ${review.id}: not approved on its own:`, (error as Error).message),
    );
  }
}

/** Pine took the answer: the turn, the review and the episode move on together. */
function answered(review: ReviewRow, session: SessionRow, nextTurnId: string): void {
  transaction(() => {
    run("update turns set state = 'answered', next_turn_id = ?, settled = 1 where id = ?", nextTurnId, review.turn_id);
    run("update reviews set state = 'answered' where id = ?", review.id);
    if (session.episode_id) run("update episodes set state = 'working', updated_at = ? where id = ?", now(), session.episode_id);
  });
}

/**
 * Decisions the engine was sending when it stopped. Pine says whether the answer arrived:
 * if it did, the work goes on; if not, the review opens again for the maker to send.
 */
export async function reconcileSending(): Promise<void> {
  for (const review of all<ReviewRow>("select * from reviews where state = 'sending'")) {
    if (sending.has(review.id)) continue;
    const session = sessionRow(review.session_id);
    const computer = session && computerRow(session.computer_id);
    if (!session || session.state !== "open" || computer?.state !== "running") {
      run("update reviews set state = 'ended' where id = ? and state = 'sending'", review.id);
      continue;
    }
    try {
      const info = await fleet().wait(computerRef(computer), sessionRef(session), review.turn_id, 1_000);
      if (info.state === "answered" && info.nextTurnId) {
        answered(review, session, info.nextTurnId);
        followTurn(session.id, info.nextTurnId);
      } else if (info.state === "needs_input" || info.state === "completed") {
        // Not taken (a stop that ended its turn has its decision saved as a run along with the review's answered state).
        run("update reviews set state = 'open' where id = ? and state = 'sending'", review.id);
      }
    } catch (error) {
      console.error(`review ${review.id}:`, (error as Error).message); // asked again at the next reconcile
    }
    publish(`drama:${review.drama_id}`, "inbox");
  }
}

async function send(reviewId: string, decision: Decision): Promise<ReviewRow> {
  const review = reviewRow(reviewId);
  if (!review) throw new StudioError("not-found", "No such review.", 404);
  if (review.state !== "open") throw review.state === "saving" ? new StudioError("review-saving", "Its files are still being saved.", 409) : new StudioError("review-closed", "This review is no longer open.", 409);
  const files = filesOfStop(review);
  const { items } = itemsOf(review.kind, files);
  const labels = new Map(items.map((item) => [item.key, item.label]));
  // The pictures the maker added to this drama, which a note may carry.
  const references = new Map(all<FileRow>("select * from files where drama_id = ? and kind = 'reference'", review.drama_id).map((file) => [file.id, file]));
  // Keep verdicts for this review's items only, and a note's file only if it belongs to that item.
  const itemFiles = new Map(items.map((item) => [item.key, new Set(item.files.map((file) => file.id))]));
  const kept: Decision = {
    words: decision.words ?? "",
    items: (decision.items ?? [])
      .filter((item) => itemFiles.has(item.key))
      .map((item) => ({
        key: item.key,
        verdict: item.verdict === "revise" ? "revise" : "approve",
        notes: (item.notes ?? []).map((note) => ({
          ...note,
          fileId: note.fileId !== undefined && itemFiles.get(item.key)!.has(note.fileId) ? note.fileId : undefined,
          image: note.image !== undefined && references.has(note.image) ? note.image : undefined,
        })),
      })),
  };
  if (review.kind === "question" && !kept.words.trim()) throw new StudioError("answer-missing", "Write an answer first.");
  if (review.kind !== "question" && (!items.length || kept.items.length !== items.length)) throw new StudioError("verdicts-missing", "Give every item a verdict first.");
  const context = { kind: review.kind, subject: subject(review), labels, paths: new Map(files.map((file) => [file.id, file.rel_path])) };
  const pictures = [...new Set(kept.items.flatMap((item) => item.notes.flatMap((note) => (note.image !== undefined ? [note.image] : []))))].map((id) => references.get(id)!);

  // Kept as written for a session that later resumes the work; said again below with where its pictures are.
  run("update reviews set state = 'sending', decision = ?, answer = ?, decided_at = ? where id = ?", JSON.stringify(kept), answerText(kept, context), now(), reviewId);
  publish(`drama:${review.drama_id}`, "inbox");

  const session = sessionRow(review.session_id);
  const computer = session && computerRow(session.computer_id);
  if (!session || session.state !== "open" || computer?.state !== "running") {
    run("update reviews set state = 'ended' where id = ?", reviewId);
    publish(`drama:${review.drama_id}`, "inbox");
    return reviewRow(reviewId)!;
  }
  // The maker's pictures go into the session first, so the answer can say where they are.
  let answer: string;
  try {
    const { sent } = await attach(session, pictures);
    answer = answerText(kept, { ...context, images: new Map(pictures.map((file, index) => [file.id, sent[index]])) });
  } catch (error) {
    run("update reviews set state = 'open' where id = ?", reviewId);
    publish(`drama:${review.drama_id}`, "inbox");
    throw new StudioError("send-failed", `Couldn't send the decision: ${(error as Error).message}`, 502, (error as Error).message);
  }
  run("update reviews set answer = ? where id = ?", answer, reviewId);
  const turn = get<TurnRow>("select * from turns where id = ?", review.turn_id);
  if (turn && turn.state !== "needs_input") {
    // The agent ended its turn to stop for the maker: the decision is the session's next run,
    // saved with the review's new state, then sent (and resent by the clock until Pine has it).
    const code = review.episode_id ? episodeCode(episodeRow(review.episode_id)!) : null;
    const key = transaction(() => {
      const saved = saveRun(session.id, "decision", decisionGoal(answer, code));
      run("update reviews set state = 'answered' where id = ?", review.id);
      if (session.episode_id) run("update episodes set state = 'working', updated_at = ? where id = ?", now(), session.episode_id);
      return saved;
    });
    await sendRun(key).catch((error) => console.error(`review ${review.id}:`, (error as Error).message));
    publish(`drama:${review.drama_id}`, "inbox", `session:${session.id}`);
    return reviewRow(reviewId)!;
  }
  try {
    const next = await fleet().answer(computerRef(computer), sessionRef(session), review.turn_id, answer);
    transaction(() => {
      answered(review, session, next.turnId);
      recordTurn(session.id, next);
    });
    followTurn(session.id, next.turnId);
  } catch (error) {
    const status = (error as { status?: number }).status;
    // The turn can't take an answer any more: the session moved on or ended. Keep the decision.
    run("update reviews set state = ? where id = ?", status === 404 || status === 409 ? "ended" : "open", reviewId);
    publish(`drama:${review.drama_id}`, "inbox");
    if (status !== 404 && status !== 409) throw new StudioError("send-failed", `Couldn't send the decision: ${(error as Error).message}`, 502, (error as Error).message);
  }
  publish(`drama:${review.drama_id}`, "inbox", `session:${session.id}`);
  return reviewRow(reviewId)!;
}

/** An ended review's decision, carried into a new session for its episode (rule 3: only on the maker's click). */
export function resumeWithDecision(reviewId: string): void {
  const review = reviewRow(reviewId);
  if (!review) throw new StudioError("not-found", "No such review.", 404);
  if (review.state !== "ended") throw new StudioError("review-not-ended", "This review hasn't ended.", 409);
  if (!review.episode_id) throw new StudioError("setup-restarts", "The drama's setup restarts on its own.", 409);
  run(
    "update episodes set state = 'queued', resume = 1, carry = ?, updated_at = ? where id = ? and state in ('stopped', 'failed', 'waiting', 'working')",
    review.answer ?? "",
    now(),
    review.episode_id,
  );
  run("update reviews set state = 'answered' where id = ?", reviewId);
  publish(`drama:${review.drama_id}`, "inbox");
}
