// What the pages show, built from the studio's records.
import {
  type CastGroup,
  type ChatView,
  type ComputerView,
  type DramaCard,
  type DramaView,
  type EpisodeRow as EpisodeView,
  type HoldReason,
  type ReviewKind,
  type ReviewSummary,
  type ReviewView,
  STAGES,
  type Stage,
  type StageCell,
  type Still,
  type ChatMessage,
  type Decision,
  type ReviewItem,
  type Spend,
} from "../shared/types.ts";
import { START_ATTEMPTS, fleet, hasFleet, projectLimits } from "./computers.ts";
import { atProjectLimit } from "./scheduler.ts";
import { all, get } from "./db.ts";
import { LENGTHS } from "./goals.ts";
import { type FileRow, fileUrl, filesOfStop, toItem, versionNumber } from "./library.ts";
import { type ComputerRow, type DramaRow, type EpisodeRow, type ReviewRow, type SessionRow, episodeCode, latestTurn, session as sessionRow } from "./records.ts";
import { itemsOf, pendingReview } from "./reviews.ts";

function still(file: FileRow): Still {
  return file.type.startsWith("video/") ? { url: fileUrl(file), video: true } : { url: fileUrl(file) };
}

/** The first three characters' base looks, newest version each: the leads on the poster. */
function castFaces(dramaId: string): string[] {
  const rows = all<FileRow>(
    "select * from files where drama_id = ? and kind = 'look' and (look is null or look = 'base') and type like 'image/%' order by id",
    dramaId,
  );
  // A Map keeps each character where it first appeared, the leads first; later versions replace earlier ones.
  const newest = new Map<string, FileRow>();
  for (const row of rows) newest.set(row.subject ?? row.name, row);
  return [...newest.values()].slice(0, 3).map(fileUrl);
}

/** What the sessions of a drama or an episode have cost so far: every turn, its late charges included. */
function spend(column: "drama_id" | "episode_id", id: string): Spend {
  const row = get<{ total: number | null; media: number | null; unpriced: number | null }>(
    `select sum(t.cost) as total, sum(t.media) as media, sum(t.cost is null and t.ended_at is not null) as unpriced
     from turns t join sessions s on s.id = t.session_id where s.${column} = ?`,
    id,
  );
  const cents = (value: number | null | undefined) => Math.round((value ?? 0) * 100) / 100;
  return { total: cents(row?.total), media: cents(row?.media), partial: (row?.unpriced ?? 0) > 0 };
}

export function dramaCard(drama: DramaRow): DramaCard {
  const counts = all<{ state: string; n: number }>("select state, count(*) as n from episodes where drama_id = ? group by state", drama.id);
  const n = (state: string) => counts.find((row) => row.state === state)?.n ?? 0;
  const waiting = get<{ n: number }>("select count(*) as n from reviews where drama_id = ? and state in ('open', 'saving')", drama.id)?.n ?? 0;
  return {
    id: drama.id,
    mode: drama.mode,
    rehearsal: drama.rehearsal === 1,
    title: drama.title,
    language: drama.language,
    look: drama.look,
    preset: drama.preset,
    format: drama.format,
    status: drama.status,
    episodes: { total: counts.reduce((sum, row) => sum + row.n, 0), done: n("done"), waiting: n("waiting") + n("stopped") + n("failed"), working: n("working") },
    computers: get<{ n: number }>("select count(*) as n from computers where drama_id = ? and state in ('running', 'starting')", drama.id)?.n ?? 0,
    waiting,
    cast: castFaces(drama.id),
    spent: spend("drama_id", drama.id),
    createdAt: drama.created_at,
  };
}

export function dramaCards(): DramaCard[] {
  return all<DramaRow>("select * from dramas order by created_at desc").map(dramaCard);
}

const REVIEW_STAGE: Partial<Record<ReviewKind, number>> = { storyboards: 2, takes: 3, cut: 4 };
const FILE_STAGE: Partial<Record<string, number>> = { breakdown: 0, blocking: 1, frame: 1, storyboard: 2, take: 3, cut: 4 };

function stageCells(episode: EpisodeRow, files: FileRow[], reviews: ReviewRow[]): Record<Stage, StageCell> {
  const segments = (kind: string) => new Set(files.filter((file) => file.kind === kind).map((file) => file.segment)).size;
  const counts: Partial<Record<Stage, number>> = { blocking: segments("blocking"), storyboards: segments("storyboard"), takes: segments("take") };
  let current = Math.max(-1, ...files.map((file) => FILE_STAGE[file.kind] ?? -1));
  // Pre-production wrote and the maker accepted the breakdown: the episode's own work starts after it.
  if (current === FILE_STAGE.breakdown) current += 1;
  const answered = reviews.filter((review) => review.state === "answered" && review.decision);
  for (const review of answered) {
    const decision = JSON.parse(review.decision!) as { items: { verdict: string }[] };
    const approved = decision.items.length > 0 && decision.items.every((item) => item.verdict === "approve");
    if (review.kind === "storyboards" && approved) current = Math.max(current, 3);
    if (review.kind === "takes" && approved) current = Math.max(current, 4);
  }
  const open = reviews.find((review) => review.state === "open" || review.state === "saving");
  const reviewing = open ? REVIEW_STAGE[open.kind] : undefined;
  if (reviewing !== undefined) current = reviewing;
  if (current < 0) current = 0;

  const cells = {} as Record<Stage, StageCell>;
  STAGES.forEach((stage, index) => {
    let state: StageCell["state"] = "none";
    if (episode.state === "done" || index < current) state = "done";
    else if (index === current) {
      if (reviewing === index) state = "review";
      else if (episode.state === "working" || episode.state === "waiting") state = "working";
      else if (files.some((file) => FILE_STAGE[file.kind] === index)) state = "done";
    }
    cells[stage] = { state, count: counts[stage] || undefined };
  });
  return cells;
}

function computerLabel(session: SessionRow | undefined): string | undefined {
  if (!session || session.state !== "open") return undefined;
  return get<{ label: string }>("select label from computers where id = ?", session.computer_id)?.label;
}

export function episodeViews(dramaId: string): EpisodeView[] {
  const episodes = all<EpisodeRow>("select * from episodes where drama_id = ? order by number", dramaId);
  const queued = episodes.filter((episode) => episode.state === "queued");
  return episodes.map((episode) => {
    const files = all<FileRow>("select * from files where episode_id = ?", episode.id);
    const reviews = all<ReviewRow>("select * from reviews where episode_id = ? order by created_at", episode.id);
    const open = reviews.find((review) => review.state === "open" || review.state === "saving");
    const session = episode.session_id ? sessionRow(episode.session_id) : undefined;
    const newest = (kind: FileRow["kind"]) => files.findLast((file) => file.kind === kind && /^(image|video)\//.test(file.type));
    // A blocking reference is a diagram the storyboards are drawn from: a cover only while there is nothing else.
    const frame = newest("cut") ?? newest("take") ?? newest("frame") ?? newest("storyboard") ?? newest("blocking");
    return {
      id: episode.id,
      number: episode.number,
      code: episodeCode(episode),
      title: episode.title,
      state: episode.state,
      stages: stageCells(episode, files, reviews),
      activity: episode.state === "working" ? session?.activity ?? undefined : undefined,
      // Only the agent's own account of why it stopped; the engine's reasons are for the agent.
      note: episode.state === "failed" ? episode.note || undefined : undefined,
      frame: frame ? still(frame) : undefined,
      position: episode.state === "queued" ? queued.indexOf(episode) + 1 : undefined,
      waitingFor: episode.state === "waiting" ? (open?.state === "saving" ? "saving" : open?.kind ?? "question") : undefined,
      computer: computerLabel(session),
      reviewId: open?.id,
      spent: spend("episode_id", episode.id),
      updatedAt: episode.updated_at,
    };
  });
}

export function crew(dramaId: string): ComputerView[] {
  return all<ComputerRow>("select * from computers where drama_id = ? and state != 'stopped' order by created_at", dramaId).map((computer) => ({
    id: computer.id,
    label: computer.label,
    state: computer.state,
    idleTimeoutMinutes: computer.idle_timeout ? Math.round(computer.idle_timeout / 60) : null,
    lastError: computer.last_error ?? undefined,
    sessions: all<SessionRow>("select * from sessions where computer_id = ? and state = 'open' order by created_at", computer.id).map((session) => {
      const episode = session.episode_id ? get<EpisodeRow>("select * from episodes where id = ?", session.episode_id) : undefined;
      return {
        id: session.id,
        name: session.name,
        role: session.role,
        episode: episode ? episodeCode(episode) : undefined,
        state: session.state,
        activity: session.activity ?? undefined,
        waiting: latestTurn(session.id)?.state === "needs_input",
      };
    }),
  }));
}

export function dramaView(drama: DramaRow): DramaView {
  const setupSession = get<SessionRow>("select * from sessions where drama_id = ? and role = 'setup' order by created_at desc limit 1", drama.id);
  const setupReview = get<ReviewRow>(
    "select r.* from reviews r join sessions s on s.id = r.session_id where r.drama_id = ? and s.role = 'setup' and r.state in ('open', 'saving') limit 1",
    drama.id,
  );
  const setupState: DramaView["setup"]["state"] =
    drama.status === "stopped" ? "stopped" : drama.status !== "setup" ? "done" : setupReview ? "waiting" : "working";
  return {
    ...dramaCard(drama),
    notes: drama.notes,
    length: drama.length,
    parallel: drama.parallel,
    perComputer: drama.per_computer,
    reviewing: drama.reviewing,
    inputs: {
      preset: drama.preset,
      screenplayLanguage: drama.screenplay_language,
      screenplay: drama.screenplay_file,
      files: all<{ id: number; name: string }>("select f.id, f.name from files f join inputs i on i.file_id = f.id where i.drama_id = ? and f.kind = 'screenplay' order by f.id", drama.id),
      // A drama made before the studio wrote brief.md, with no episode length to write it from.
      needsLength: !LENGTHS[drama.length] && !get("select 1 from inputs i join files f on f.id = i.file_id where i.drama_id = ? and f.kind = 'brief'", drama.id),
    },
    setup: {
      state: setupState,
      reviewId: setupReview?.id,
      kind: setupReview?.kind,
      reached: setupReached(drama.id),
      activity: setupSession?.state === "open" ? setupSession.activity ?? undefined : undefined,
      note: drama.note || undefined,
      reason: (drama.reason || undefined) as HoldReason | undefined,
    },
    episodeRows: episodeViews(drama.id),
    crew: crew(drama.id),
    stalled: stalled(drama),
    atLimit: atLimit(drama),
  };
}

/**
 * How far the setup has got, by what it has made and what the maker answered (the agent may
 * approve the leads by a plain question, or skip one): 0 reading, 1 asking, 2 drawing the
 * leads, 3 their approval, 4 preparing every episode, 5 the shared references' approval.
 */
function setupReached(dramaId: string): number {
  const made = new Set(all<{ kind: string; look: string | null }>("select kind, look from files where drama_id = ? and episode_id is null", dramaId).map((file) => (file.kind === "look" && file.look && file.look !== "base" ? "state" : file.kind)));
  const reviews = all<{ kind: string; state: string }>("select r.kind, r.state from reviews r join sessions s on s.id = r.session_id where r.drama_id = ? and s.role = 'setup'", dramaId);
  if (reviews.some((review) => review.kind === "references")) return 5;
  if (reviews.some((review) => review.kind === "looks" && review.state === "answered") || ["breakdown", "location", "prop", "state"].some((kind) => made.has(kind))) return 4;
  if (reviews.some((review) => review.kind === "looks")) return 3;
  if (made.has("look") || reviews.some((review) => review.state === "answered")) return 2;
  return reviews.length ? 1 : 0;
}

/** The project's limit, when this drama has work waiting that no Computer of its own can take. */
function atLimit(drama: DramaRow): number | undefined {
  if (!hasFleet() || fleet().mode !== drama.mode || !atProjectLimit()) return undefined;
  const queued = get<{ n: number }>("select count(*) as n from episodes where drama_id = ? and state = 'queued'", drama.id)?.n ?? 0;
  const setupWaits = drama.status === "setup" && !get("select id from sessions where drama_id = ? and role = 'setup' and state = 'open'", drama.id);
  return queued || setupWaits ? projectLimits().maxComputers ?? undefined : undefined;
}

/** A Computer that failed to start too often to keep trying on its own, while none of the drama's runs. */
function stalled(drama: DramaRow): DramaView["stalled"] {
  const running = get<{ n: number }>("select count(*) as n from computers where drama_id = ? and mode = ? and state in ('starting', 'running')", drama.id, drama.mode)?.n ?? 0;
  if (running) return undefined;
  const failed = get<ComputerRow>(
    "select * from computers where drama_id = ? and mode = ? and project = ? and state = 'failed' and failures >= ? order by updated_at desc limit 1",
    drama.id,
    drama.mode,
    hasFleet() ? fleet().project : "",
    START_ATTEMPTS,
  );
  return failed ? { computer: failed.label, error: failed.last_error ?? "" } : undefined;
}

export function castGroups(dramaId: string): CastGroup[] {
  const rows = all<FileRow>("select * from files where drama_id = ? and kind in ('look', 'location', 'prop') order by id desc", dramaId);
  const groups = new Map<string, CastGroup>();
  for (const row of rows) {
    const subject = row.kind === "look" && row.look && row.look !== "base" ? `${row.subject}/${row.look}` : row.subject ?? row.name;
    const key = `${row.kind}|${subject}`;
    if (!groups.has(key)) groups.set(key, { kind: row.kind as CastGroup["kind"], subject, files: [] });
    groups.get(key)!.files.push(toItem(row));
  }
  for (const group of groups.values()) group.files.sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
  return [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject));
}

/** Most blocking first: the drama's setup and pre-production, then storyboards (they hold up shooting), takes, cuts, questions; oldest first. */
const PRIORITY: Record<ReviewKind, number> = { looks: 0, references: 0, storyboards: 1, takes: 2, cut: 3, question: 4 };

function summary(review: ReviewRow): ReviewSummary {
  const files = filesOfStop(review);
  const { items } = itemsOf(review.kind, files);
  const image = files.find((file) => file.type.startsWith("image/")) ?? files.find((file) => file.type.startsWith("video/"));
  const episode = review.episode_id ? get<EpisodeRow>("select * from episodes where id = ?", review.episode_id) : undefined;
  return {
    id: review.id,
    dramaId: review.drama_id,
    dramaTitle: get<{ title: string }>("select title from dramas where id = ?", review.drama_id)?.title ?? "",
    episode: episode ? episodeCode(episode) : undefined,
    episodeId: episode?.id,
    kind: review.kind,
    state: review.state,
    question: review.question,
    items: items.length,
    thumb: image ? still(image) : undefined,
    createdAt: review.created_at,
  };
}

export function inbox(dramaId?: string): ReviewSummary[] {
  const rows = all<ReviewRow & { role: string }>(
    `select r.*, s.role from reviews r join sessions s on s.id = r.session_id
     where r.state in ('open', 'saving', 'sending', 'ended') ${dramaId ? "and r.drama_id = ?" : ""}`,
    ...(dramaId ? [dramaId] : []),
  );
  const rank = (row: ReviewRow & { role: string }) => (row.state === "ended" ? 9 : row.role === "setup" ? -1 : PRIORITY[row.kind]);
  return rows.sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at)).map(summary);
}

const REVIEWED_KINDS: Partial<Record<ReviewKind, FileRow["kind"][]>> = {
  looks: ["look"],
  references: ["look", "location", "prop"],
  storyboards: ["storyboard", "blocking"],
  takes: ["take"],
  cut: ["cut"],
};

/**
 * What an item looked like before this turn: the same look, segment or cut from the latest
 * earlier turn that returned it. Nothing for a first version.
 */
function previousOf(review: ReviewRow, item: ReviewItem, before: number): Pick<ReviewItem, "previous" | "asked"> {
  const kinds = REVIEWED_KINDS[review.kind];
  if (!kinds) return {};
  const rows = all<FileRow>(
    `select * from files where drama_id = ? and id < ? and kind in (${kinds.map(() => "?").join(", ")}) order by id`,
    review.drama_id,
    before,
    ...kinds,
  ).filter((row) => {
    const place = item.key.match(/^(location|prop):(.+)$/);
    if (place) return row.kind === place[1] && row.subject === place[2];
    if (review.kind === "looks" || review.kind === "references") {
      return row.kind === "look" && (row.subject ?? "?") === item.key.split("/")[0] && (row.look ?? "base") === (item.key.split("/")[1] ?? "base");
    }
    if (row.episode_id !== review.episode_id) return false;
    return review.kind === "cut" || row.segment === item.key;
  });
  const turn = rows.at(-1)?.turn_id;
  if (!turn) return {};
  const earlier = get<ReviewRow>("select * from reviews where turn_id = ?", turn);
  const decided = earlier?.decision ? (JSON.parse(earlier.decision) as Decision).items.find((entry) => entry.key === item.key) : undefined;
  return {
    previous: itemsOf(review.kind, rows.filter((row) => row.turn_id === turn)).items[0]?.files,
    asked: decided?.notes.length ? decided.notes : undefined,
  };
}

export function reviewView(review: ReviewRow): ReviewView {
  const files = filesOfStop(review);
  const { items, other } = itemsOf(review.kind, files);
  const first = Math.min(...files.map((file) => file.id));
  const next = inbox().find((item) => item.id !== review.id && item.state === "open");
  // The episode's shot list, wherever it was written (pre-production writes them all).
  const breakdown = review.episode_id
    ? get<FileRow>("select * from files where episode_id = ? and kind = 'breakdown' and type like 'text/%' order by id desc limit 1", review.episode_id)
    : undefined;
  return {
    ...summary(review),
    reviewItems: items.map((item) => ({ ...item, ...previousOf(review, item, first) })),
    breakdown: breakdown ? toItem(breakdown) : undefined,
    otherFiles: other,
    decision: review.decision ? JSON.parse(review.decision) : undefined,
    answer: review.answer ?? undefined,
    nextId: next?.id,
    finishable:
      review.kind === "question" && review.state === "open" && review.episode_id !== null && get("select id from files where episode_id = ? and kind = 'cut' limit 1", review.episode_id) !== undefined,
  };
}

export function chatView(session: SessionRow): ChatView {
  const turn = latestTurn(session.id);
  const episode = session.episode_id ? get<EpisodeRow>("select * from episodes where id = ?", session.episode_id) : undefined;
  const review = pendingReview(session.id);
  const sends: ChatView["sends"] =
    session.state !== "open"
      ? "none"
      : review
        ? review.kind !== "question"
          ? "review"
          : "answer"
        : turn && !turn.ended_at && turn.state !== "answered"
          ? "steer"
          : "run";
  // What the agent was sent, told apart: the studio's goals, the maker's review decisions, the maker's own words.
  const briefs = new Set(all<{ goal: string }>("select goal from runs where session_id = ? and kind != 'chat'", session.id).map((row) => row.goal));
  const decisions = new Map(
    all<ReviewRow>("select * from reviews where session_id = ? and answer is not null and kind != 'question'", session.id).map((row) => [row.answer!, row]),
  );
  const messages = all<ChatMessage>("select id, kind, text, at from messages where session_id = ? order by id desc limit 200", session.id)
    .reverse()
    .map((message): ChatMessage => {
      if (message.kind !== "input") return message;
      // A decision on a stop that ended its turn went as a run: its answer, then "carry on".
      const decided = decisions.get(message.text) ?? [...decisions.entries()].find(([answer]) => message.text.startsWith(`${answer}\n\n`))?.[1];
      if (decided) {
        const items = decided.decision ? ((JSON.parse(decided.decision) as Decision).items ?? []) : [];
        const revised = items.filter((item) => item.verdict === "revise").length;
        return { ...message, decision: { reviewId: decided.id, kind: decided.kind, approved: items.length - revised, revised } };
      }
      return briefs.has(message.text) ? { ...message, brief: true } : message;
    });
  return {
    sessionId: session.id,
    label: episode ? episodeCode(episode) : "",
    sends,
    reviewId: review && review.state !== "ended" ? review.id : undefined,
    messages,
  };
}

export function dramaFiles(dramaId: string, episodeId?: string) {
  const rows = episodeId
    ? all<FileRow>("select * from files where drama_id = ? and episode_id = ? order by id", dramaId, episodeId)
    : all<FileRow>("select * from files where drama_id = ? order by id", dramaId);
  return rows.map(toItem);
}
