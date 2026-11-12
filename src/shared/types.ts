// What the engine and the UI agree on: the shapes the HTTP API returns and accepts.

export type Mode = "pine" | "replay";

/** What went wrong, for the UI to say in the maker's language (src/engine/errors.ts). */
export type ErrorCode =
  | "title-missing"
  | "screenplay-missing"
  | "screenplay-unchosen"
  | "screenplay-language-missing"
  | "preset-missing"
  | "preset-unknown"
  | "length-missing"
  | "file-too-large"
  | "not-found"
  | "episode-busy"
  | "drama-not-stopped"
  | "drama-done"
  | "drama-not-held"
  | "nothing-delivered"
  | "no-cut"
  | "not-an-image"
  | "session-ended"
  | "computer-not-running"
  | "message-empty"
  | "question-closed"
  | "decide-in-review"
  | "decision-sending"
  | "review-saving"
  | "review-closed"
  | "answer-missing"
  | "verdicts-missing"
  | "send-failed"
  | "review-not-ended"
  | "setup-restarts"
  | "endpoint-invalid"
  | "key-missing"
  | "key-rejected"
  | "pine-unreachable"
  | "disconnect-first"
  | "stop-failed"
  | "no-mode"
  | "signed-out"
  | "offline"
  | "internal";

/** The body of every failed API call. */
export interface ApiFailure {
  error: string;
  code: ErrorCode;
  detail?: string;
}

/** Where a drama is: casting in its setup session, then episodes in production. */
export type DramaStatus = "setup" | "production" | "done" | "stopped";

/** Why the studio held a drama: its project's Computers don't offer Pine's drama skill. */
export type HoldReason = "no-drama-skill" | "by-maker" | "choose-inputs";

export type EpisodeState = "queued" | "working" | "waiting" | "done" | "stopped" | "failed";

/** The steps of an episode, in order, as the board shows them. */
export const STAGES = ["breakdown", "blocking", "storyboards", "takes", "cut"] as const;
export type Stage = (typeof STAGES)[number];

export type FileKind =
  | "screenplay"
  /** What the maker asks of the drama: title, format, episode length, tone (brief.md). */
  | "brief"
  | "bible"
  /** A screenplay version drama-cli recorded (screenplay/vN/screenplay.fountain): the original as checked, or the agent's Fountain rewrite. */
  | "screenplay-version"
  /** What a rewrite changed, beside its version (screenplay/vN/review.md), for the maker to read before accepting it. */
  | "screenplay-review"
  | "look"
  | "location"
  | "prop"
  | "breakdown"
  | "blocking"
  /** A photograph of the first frame of a segment's first shot, which its take starts from. */
  | "frame"
  | "storyboard"
  | "take"
  | "cut"
  /** A cut's subtitles: its lines and cards, timed, beside the picture (cut.srt). */
  | "subtitles"
  | "observation"
  /** A part of a packed drama-cli project (the whole drama's, or one episode's), handed from session to session. */
  | "archive"
  /** drama-cli's status of the project, which each stop returns for the studio (handoff/status.json). */
  | "status"
  /** drama-cli's lineage of the project, which each stop returns for the studio's Graph (handoff/lineage.json). */
  | "lineage"
  /** The project as infinite-canvas's import reads it, written by drama-cli export infinite-canvas, which each stop returns for the studio's Export menu (handoff/infinite-canvas.zip). */
  | "infinite-canvas"
  /** The drama-cli refusals a stop asks the maker about, as drama-cli printed them (handoff/refusals.jsonl). */
  | "refusal"
  /** drama-cli's statement of a version's job, in its folder (spec.json): the prompt, references and settings it made it from. */
  | "spec"
  /** What drama-cli sent the provider for a version (request.json). */
  | "request"
  /** drama-cli's record of a version's picture in the asset library (asset/asset.json): its Id, which a request names as asset://<Id>. */
  | "asset"
  /** A picture the maker added to a note: a face to use, a costume, a place to match. */
  | "reference"
  | "other";

/** What a question asks the maker to decide, inferred from its words and its files. */
export type ReviewKind = "looks" | "references" | "storyboards" | "takes" | "cut" | "question";

/**
 * What the maker reviews: every step; the key ones, the leads' looks and each episode's cut;
 * or none. The studio approves the rest as the agent stops for it; a question always waits.
 */
export type Reviewing = "every" | "key" | "none";

/**
 * saving: the turn's files are still being copied; the question can't be answered yet.
 * open: waiting for the maker. sending: the answer is on its way.
 * answered: the agent has it. ended: the session that asked is gone.
 */
export type ReviewState = "saving" | "open" | "sending" | "answered" | "ended";

export type Verdict = "approve" | "revise";

export interface AppInfo {
  /** "none" until the maker connects a Pine project or chooses the replay. */
  mode: Mode | "none";
  version: string;
  dataDir: string;
  project?: { endpoint: string; keyHint: string; fromEnvironment: boolean };
  /** Whether the project offers Pine's drama skill, as its Computers last said; absent until one has. */
  dramaSkill?: "offered" | "missing";
}

export interface FileItem {
  id: number;
  name: string;
  path: string;
  type: string;
  size: number;
  kind: FileKind;
  episode?: string;
  segment?: string;
  /** The character, location or prop the file shows. */
  subject?: string;
  look?: string;
  /** line-art or photoreal, for storyboards. */
  style?: string;
  version?: string;
  url: string;
  createdAt: string;
}

/** What work has cost so far at the project's rates: every turn of its agents, generated video included. */
export interface Spend {
  total: number;
  /** The part of it that is generated video (Pine's additional charges). */
  media: number;
  /** Some turns couldn't be priced, so the total is at least this. */
  partial: boolean;
}

export interface DramaCard {
  id: string;
  /** Where its work runs; a drama of the other mode waits until the studio is back in its mode. */
  mode: Mode;
  /** Pine's agent stands in for the drama skill with placeholder files. */
  rehearsal: boolean;
  title: string;
  language: string;
  /** What a drama made before New drama asked for a preset looks like; "" since. */
  look: string;
  /** The drama-cli preset (shared/presets.ts); "" for a rehearsal or a drama made before New drama asked. */
  preset: string;
  format: string;
  status: DramaStatus;
  /** waiting: episodes that need the maker, for an answer or to be resumed (the board's "Needs you"). */
  episodes: { total: number; done: number; waiting: number; working: number };
  /** Computers running for this drama. */
  computers: number;
  waiting: number;
  /** The leads' sheets, once drawn: the faces on the drama's poster. */
  cast: string[];
  spent: Spend;
  createdAt: string;
}

export interface StageCell {
  state: "none" | "working" | "review" | "done";
  count?: number;
}

export interface EpisodeRow {
  id: string;
  number: number;
  code: string;
  title: string;
  state: EpisodeState;
  stages: Record<Stage, StageCell>;
  /** The agent's own words for what it is doing, while it works. */
  activity?: string;
  /** The agent's own account of why it stopped early. */
  note?: string;
  /** Where it has got to, as a picture: its newest cut, else take, else blocking frame, else storyboard. */
  frame?: Still;
  /** Its place in the queue, from 1. */
  position?: number;
  /** What it waits for the maker on; "saving" while the review's files are saved. */
  waitingFor?: ReviewKind | "saving";
  computer?: string;
  reviewId?: string;
  /** What its sessions have cost so far, generated video included. */
  spent: Spend;
  updatedAt: string;
}

export interface SessionView {
  id: string;
  name: string;
  role: "setup" | "episode";
  episode?: string;
  state: "open" | "closed" | "lost";
  activity?: string;
  waiting: boolean;
}

export interface ComputerView {
  id: string;
  label: string;
  state: string;
  idleTimeoutMinutes: number | null;
  sessions: SessionView[];
  lastError?: string;
}

export interface DramaView extends DramaCard {
  notes: string;
  /** About this many seconds an episode (60, 90, 120); "" for a drama made before it was asked. */
  length: string;
  parallel: number;
  perComputer: number;
  reviewing: Reviewing;
  /** What drama-cli init takes that the maker chooses: "" or null until chosen; files are the maker's own, the screenplay among them. */
  inputs: { preset: string; screenplayLanguage: string; screenplay: number | null; files: { id: number; name: string }[]; needsLength: boolean };
  setup: {
    state: "working" | "waiting" | "done" | "stopped";
    reviewId?: string;
    kind?: ReviewKind;
    /** How far it has got: 0 reading, 1 asking, 2 drawing the leads, 3 their approval, 4 preparing every episode, 5 the shared references' approval. */
    reached: number;
    activity?: string;
    note?: string;
    /** The studio held the drama before any work, and why. */
    reason?: HoldReason;
  };
  episodeRows: EpisodeRow[];
  crew: ComputerView[];
  /** Its Computers wouldn't start, several times: the line waits for the maker's "try again". */
  stalled?: { computer: string; error: string };
  /** Work waits because the project runs as many Computers as it may: how many that is. */
  atLimit?: number;
}

export interface CastGroup {
  kind: "look" | "location" | "prop";
  subject: string;
  /** Newest first. */
  files: FileItem[];
}

/** A picture of the work for a card or a list: an image, or a video to show the opening frame of. */
export interface Still {
  url: string;
  video?: boolean;
}

export interface ReviewSummary {
  id: string;
  dramaId: string;
  dramaTitle: string;
  episode?: string;
  episodeId?: string;
  kind: ReviewKind;
  state: ReviewState;
  question: string;
  items: number;
  thumb?: Still;
  createdAt: string;
}

/** One thing the maker gives a verdict on: a segment's storyboard, a character's look, a take, the cut. */
export interface ReviewItem {
  key: string;
  label: string;
  files: FileItem[];
  /** The same thing as it was before this turn redid it, to compare side by side. */
  previous?: FileItem[];
  /** What the maker asked of that earlier version, pinned where they put it. */
  asked?: Note[];
}

/** A note pinned to a spot on an image (fractions of its width and height) or a time in a video. */
export interface Note {
  fileId?: number;
  x?: number;
  y?: number;
  time?: number;
  text: string;
  /** A picture the maker added for the agent to use or match (a library file of kind "reference"). */
  image?: number;
}

export interface ItemDecision {
  key: string;
  verdict: Verdict;
  notes: Note[];
}

export interface Decision {
  items: ItemDecision[];
  /** The maker's own words, quoted in the record of what they approved. */
  words: string;
}

export interface ReviewView extends ReviewSummary {
  /** The episode's breakdown, for its shot list. */
  breakdown?: FileItem;
  reviewItems: ReviewItem[];
  otherFiles: FileItem[];
  decision?: Decision;
  answer?: string;
  /** The next review waiting, to move on to after this one. */
  nextId?: string;
  /** An episode's plain question while it has a cut: the maker may call the episode finished instead of answering. */
  finishable?: boolean;
}

export interface ChatMessage {
  id: number;
  kind: "input" | "progress" | "activity" | "question" | "answer" | "result";
  text: string;
  at: string;
  /** An input that was the studio's own goal for a run, not something the maker wrote. */
  brief?: boolean;
  /** An input that was the maker's decision on a review, sent in the agent's terms. */
  decision?: { reviewId: string; kind: ReviewKind; approved: number; revised: number };
}

export interface ChatView {
  sessionId: string;
  /** The episode's code; empty for the drama's setup. */
  label: string;
  /**
   * What a message would do now: answer the waiting question, steer the running turn, or
   * start a run. "review" when the agent waits on files the maker decides in their review.
   */
  sends: "answer" | "review" | "steer" | "run" | "none";
  /** The review the agent waits on, if any. */
  reviewId?: string;
  messages: ChatMessage[];
}

export type LiveMessage = { type: "changed"; scope: string } | { type: "hello" };

/* Browsing the drama outside reviews: episodes, the script, delivery and the cast. */

/** The maker's decision on the item a review showed, as recorded: it covers everything that item held. */
export interface Judged {
  reviewId: string;
  kind: ReviewKind;
  state: ReviewState;
  verdict?: Verdict;
  notes: Note[];
}

/** What one turn returned for one thing (a segment's storyboards or takes, the cut, a look), and the review that showed it. */
export interface Receipt {
  turnId: string;
  files: FileItem[];
  review?: Judged;
}

export interface SegmentPage {
  key: string;
  /** The line-art and photoreal storyboards, newest receipt first. */
  boards: Receipt[];
  /** The blocking reference and the first-frame reference the storyboards and takes are drawn from, newest receipt first. */
  stills: Receipt[];
  takes: Receipt[];
}

/** One episode, whatever stage it is at: what it holds, receipt by receipt. Read only; decisions happen in reviews. */
export interface EpisodePage {
  dramaId: string;
  dramaTitle: string;
  format: string;
  row: EpisodeRow;
  previous?: string;
  next?: string;
  breakdown?: FileItem;
  segments: SegmentPage[];
  cuts: Receipt[];
  /** Everything else the episode's sessions returned, recognised or not. */
  other: FileItem[];
}

export interface ScriptPage {
  inputs: FileItem[];
  /** The input the maker marked as the screenplay, the original a rewrite is set beside. */
  screenplayFile: number | null;
  /** The newest screenplay version drama-cli recorded, its review when it is a rewrite, and whether a question still waits on it. */
  screenplay?: { version: string; file?: FileItem; review?: FileItem; pending: boolean };
  bible?: FileItem;
  breakdowns: { code: string; title?: string; file: FileItem }[];
}

export interface DeliveryRow {
  episodeId?: string;
  code: string;
  title: string;
  state?: EpisodeState;
  /** together: how many cuts the review of this one showed; a verdict on several is on them as a group. */
  latest?: { file: FileItem; review?: Judged; together: number };
  /** The cut the maker approved: the one cut its newest approved cut review showed. */
  accepted?: FileItem;
  /** That review showed several cuts, so which one was approved isn't known. */
  ambiguous?: boolean;
}

/** A character, place or prop, with every version of each of its looks and what the maker decided. */
export interface CastCard {
  kind: "look" | "location" | "prop";
  subject: string;
  looks: { look: string; versions: Receipt[] }[];
  /** The episodes whose breakdown names it, by its id or its full name. */
  episodes: string[];
}
