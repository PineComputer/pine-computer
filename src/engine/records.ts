// The studio's rows, typed, and the small queries several modules share.
import type { DramaStatus, EpisodeState, Mode, ReviewKind, ReviewState, Reviewing } from "../shared/types.ts";
import { all, get, run } from "./db.ts";

export interface DramaRow {
  id: string;
  title: string;
  language: string;
  look: string;
  format: string;
  parallel: number;
  per_computer: number;
  notes: string;
  /** Each episode's length, about this many seconds (60, 90, 120); "" for a drama made before it was asked. */
  length: string;
  /** Where its work runs: a replay drama never starts Pine Computers, and a Pine drama never plays in replay. */
  mode: Mode;
  /** 1 for a rehearsal: Pine's agent stands in for the drama skill with placeholder files. */
  rehearsal: number;
  reviewing: Reviewing;
  /** The drama-cli preset the maker chose; "" until chosen. */
  preset: string;
  /** en | zh, as drama-cli init --screenplay-language takes it; "" until chosen. */
  screenplay_language: string;
  /** The input file that is the screenplay; null until chosen. */
  screenplay_file: number | null;
  status: DramaStatus;
  note: string;
  /** Why the studio held it, as a code the app words (HoldReason); empty when it didn't. */
  reason: string;
  continues: number;
  created_at: string;
  updated_at: string;
}

export interface EpisodeRow {
  id: string;
  drama_id: string;
  number: number;
  title: string;
  state: EpisodeState;
  session_id: string | null;
  note: string;
  resume: number;
  carry: string;
  continues: number;
  updated_at: string;
}

export interface ComputerRow {
  id: string;
  drama_id: string;
  mode: Mode;
  /** The project it was made in (Fleet.project); it can only be started again there. */
  project: string;
  label: string;
  credentials: string;
  binding: string | null;
  revision: string | null;
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  idle_timeout: number | null;
  /** When Pine will stop it because its running time per start is up; null where the project sets no limit. */
  stop_by: string | null;
  last_error: string | null;
  failures: number;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  computer_id: string;
  drama_id: string;
  name: string;
  token: string | null;
  role: "setup" | "episode";
  episode_id: string | null;
  state: "open" | "closed" | "lost";
  task_id: string | null;
  cursor: string | null;
  activity: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface TurnRow {
  id: string;
  session_id: string;
  state: string;
  question: string;
  summary: string;
  files_saved: number;
  returned: string;
  settled: number;
  save_error: string | null;
  cost: number | null;
  media: number | null;
  next_turn_id: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface ReviewRow {
  id: string;
  drama_id: string;
  episode_id: string | null;
  session_id: string;
  turn_id: string;
  kind: ReviewKind;
  state: ReviewState;
  question: string;
  decision: string | null;
  answer: string | null;
  created_at: string;
  decided_at: string | null;
}

export const drama = (id: string) => get<DramaRow>("select * from dramas where id = ?", id);
export const episode = (id: string) => get<EpisodeRow>("select * from episodes where id = ?", id);
export const computer = (id: string) => get<ComputerRow>("select * from computers where id = ?", id);
export const session = (id: string) => get<SessionRow>("select * from sessions where id = ?", id);
export const review = (id: string) => get<ReviewRow>("select * from reviews where id = ?", id);

export function openSessionsOf(computerId: string): SessionRow[] {
  return all<SessionRow>("select * from sessions where computer_id = ? and state = 'open'", computerId);
}

/** The newest turn of a session: the one that can be answered or steered. */
export function latestTurn(sessionId: string): TurnRow | undefined {
  return get<TurnRow>("select * from turns where session_id = ? order by created_at desc, rowid desc limit 1", sessionId);
}

export function episodeCode(row: Pick<EpisodeRow, "number">): string {
  return `EP${String(row.number).padStart(3, "0")}`;
}

/**
 * A turn's cost only grows as its charges settle (generated video is billed when it is
 * done), and readings can arrive out of order, so the larger is the newer. In an upsert,
 * `from` is "excluded".
 */
export function costRaised(from: string): string {
  return ["cost", "media"].map((column) => `${column} = case when turns.${column} > ${from}.${column} then turns.${column} else ${from}.${column} end`).join(", ");
}

/** A newer reading of a turn's cost and the additional charges in it. */
export function raiseCost(turnId: string, cost: number | null, media: number | null): void {
  run(`update turns set ${costRaised("reading")} from (select ? as cost, ? as media) as reading where id = ?`, cost, media, turnId);
}
