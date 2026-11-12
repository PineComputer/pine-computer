// The Pine Computer calls the studio makes, in one place. Pine's SDK backs them in pine
// mode (pine-fleet.ts); recorded turns back them in replay mode (replay-fleet.ts), for
// development, tests and demos without a project key or any spend.
import type { Mode } from "../shared/types.ts";

/** What the studio keeps to reach a Computer, unsealed for the duration of a call. */
export interface ComputerRef {
  id: string;
  credentials: string;
  binding: string;
}

export interface SessionRef {
  name: string;
  token: string;
}

export interface TurnFile {
  path: string;
  size: number;
  sha256: string;
  type: string;
}

export interface TurnInfo {
  turnId: string;
  /** running | canceling | needs_input | answered | completed | failed | canceled */
  state: string;
  question: string;
  summary: string;
  nextTurnId: string;
  files: TurnFile[];
  /**
   * Pine's rated cost of the turn so far, or null where it couldn't price it: the agent's model
   * use plus additional charges, generated video above all. Those can settle after the turn
   * ends; a usage event then carries the turn's new total.
   */
  cost: number | null;
  /** The additional charges in cost (generated video), or null where they couldn't be priced. */
  media: number | null;
}

export interface FleetEvent {
  id: string;
  taskId: string;
  turnId: string;
  kind: "input" | "progress" | "activity" | "result" | "usage";
  text: string;
  /** For usage: the turn's cost and additional charges as of this event. */
  cost?: number | null;
  media?: number | null;
  /** For activity: the step's id, to update its row in place. */
  ref?: string;
  state?: string;
}

export interface Attached {
  binding: string;
  revision: string;
}

/** What the project allows, from Pine's project policy; null where it sets no limit. */
export interface Limits {
  /** Computers the project may run at once. */
  maxComputers: number | null;
  /** The longest idle timeout a start may ask for. */
  maxIdleSeconds: number | null;
  /** Whether a running Computer's idle timeout can be changed; without a lifetime policy it is set only at start. */
  idleAdjustable: boolean;
  /** How long one start may run, paused time included. */
  maxRuntimeSeconds: number | null;
}

/**
 * A call that failed because the project is busy, not because anything is wrong: it is at
 * its limit of Computers, or of starts this minute. Retried later without counting as a failure.
 */
export function isBusy(error: unknown): boolean {
  return (error as { retryLater?: boolean } | undefined)?.retryLater === true;
}

export interface Fleet {
  readonly mode: Mode;
  /** The project its Computers are made in, as a fingerprint that holds no secret. */
  readonly project: string;
  limits(): Promise<Limits>;
  /** New Computer credentials, to save before Create: they are the only way to start it again. */
  newCredentials(): Promise<{ id: string; credentials: string }>;
  createComputer(credentials: string, label: string, idleTimeoutSeconds: number): Promise<Attached>;
  /** Starts the Computer these credentials name; creates it if Pine never registered it (a Create whose answer was lost). */
  startComputer(credentials: string, label: string, idleTimeoutSeconds: number): Promise<Attached>;
  /** running, paused, stopped, failed…; "stopped" when Pine no longer knows the sandbox. */
  status(computer: ComputerRef): Promise<string>;
  /** When Pine will begin stopping the running Computer (its running time per start is up), where the project sets a limit. */
  stopBy(computer: ComputerRef): Promise<Date | undefined>;
  /** The skills the Computer's agents are offered: Pine's that are switched on, and the project's own. */
  skills(computer: ComputerRef): Promise<string[]>;
  /** Changes the running Computer's idle timeout; resolves with the one Pine applied. */
  setIdleTimeout(computer: ComputerRef, seconds: number): Promise<number>;
  stop(computer: ComputerRef): Promise<boolean>;
  createSession(computer: ComputerRef, label: string): Promise<SessionRef>;
  closeSession(computer: ComputerRef, name: string): Promise<void>;
  writeFile(computer: ComputerRef, session: SessionRef, name: string, content: Uint8Array): Promise<void>;
  run(computer: ComputerRef, session: SessionRef, goal: string, key: string, maxWallMs?: number): Promise<TurnInfo>;
  wait(computer: ComputerRef, session: SessionRef, turnId: string, timeoutMs: number): Promise<TurnInfo>;
  answer(computer: ComputerRef, session: SessionRef, turnId: string, text: string): Promise<TurnInfo>;
  steer(computer: ComputerRef, session: SessionRef, turnId: string, text: string): Promise<void>;
  openFile(computer: ComputerRef, session: SessionRef, path: string): Promise<ReadableStream<Uint8Array>>;
  /** One folder of the session's working directory: its files and folders, by path from the working directory. */
  listFiles(computer: ComputerRef, session: SessionRef, folder: string): Promise<{ path: string; folder: boolean; size: number }[]>;
  /** The session's agent events from a cursor, until aborted. */
  events(computer: ComputerRef, session: SessionRef, after: string | undefined, taskId: string | undefined, signal: AbortSignal): AsyncIterable<FleetEvent>;
  /** A browser-safe connection to the session's desktop, or null where there is none. */
  desktop(computer: ComputerRef, session: SessionRef): Promise<unknown | null>;
}

export const ENDED = new Set(["needs_input", "completed", "failed", "canceled"]);
