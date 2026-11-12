// What this app's API answers, shared by the routes and the page. Types only.

export interface ComputerView {
  id: string;
  /** none is never sent; stopped, starting, running, pausing, paused, resuming, stopping, failed… */
  state: string;
  sandboxId?: string;
  /** Where its browser reaches the internet from: a country code, or "direct". */
  location?: string;
  /** The idle timeout chosen for the next Start. */
  idleTimeoutSeconds?: number;
  /** False once Pause was refused: the project doesn't have Pause/Resume. */
  canPause: boolean;
  createdAt?: string;
  /** When it stops itself if nothing uses it. */
  expiresAt?: string;
  lifetime?: {
    idleTimeoutSeconds: number;
    minIdleTimeoutSeconds: number;
    maxIdleTimeoutSeconds: number;
    maxRuntimeAgeSeconds: number;
    stopAt?: string;
    deadline?: string;
  };
  /** Why the sandbox is in a failed state, in its words. */
  problem?: string;
}

export interface SessionView {
  name: string;
  label: string;
  createdAt: string;
  open: boolean;
  /** A turn of its is running. */
  working: boolean;
  /** Its latest turn asked a question. */
  waiting: boolean;
}

export interface TurnView {
  turnId: string;
  session: string;
  kind: "run" | "answer" | "schedule";
  ask: string;
  askedAt: string;
  state: string;
  scheduleId?: string;
  attachments?: string[];
  summary?: string;
  endedAt?: string;
  durationMs?: number;
  cost?: number | null;
  files?: { path: string; size: number; contentType: string }[];
}

export interface AppState {
  computer: ComputerView | null;
  sessions: SessionView[];
  turns: TurnView[];
  /** How many sessions the Computer runs at once. */
  sessionLimit: number;
  /** Skill drafts waiting for review. */
  drafts: number;
  /** The server can drive sessions with your own model (ANTHROPIC_API_KEY is set). */
  ownAgent: boolean;
}

export interface Capabilities {
  features: { id: string; title: string; description: string }[];
  limits: { id: string; description: string; value: number; unit: string; scope: string; kind: string }[];
  sessions: number;
}

export interface Ceremony {
  id: string;
  rpId: string;
  origin: string;
  userName: string;
  session: string;
  expiresAt?: string;
}

/** What the server pushes to a user's open pages. */
export type LiveEvent =
  | { type: "changed" }
  | { type: "passkeys"; ceremonies: Ceremony[] }
  | { type: "notice"; tone: "info" | "done" | "failed"; text: string; href?: string };

export interface SecretView {
  name: string;
  note?: string;
  updatedAt: string;
}

export type Cadence = { kind: "interval"; minutes: number } | { kind: "daily"; at: string; weekdays: boolean };

export interface ScheduleView {
  id: string;
  label: string;
  session: string;
  goal: string;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  nextAt: string;
  lastAt?: string;
  lastTurnId?: string;
  lastError?: string;
}

export interface SkillView {
  name: string;
  description: string;
  /** pine: one of Pine's; learned: authored on this Computer. */
  origin: "pine" | "learned";
  switchable: boolean;
  enabled?: boolean;
}

export interface SkillVersionView {
  name: string;
  version: number;
  /** pending (a draft), active, inactive */
  status: string;
  createdAt: string;
  activatedAt?: string;
  reason?: string;
  origin?: string;
  /** It touched a sign-in, MFA or payment field: never activated by itself. */
  tainted?: boolean;
  body?: string;
}

export interface SkillsState {
  skills: SkillView[];
  versions: SkillVersionView[];
  drafts: SkillVersionView[];
}

export interface WorkFile {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modifiedAt?: string;
}

export interface TabView {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface PasskeyView {
  id: string;
  rpId: string;
  userName: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface HandoffView {
  id: string;
  startedAt?: string;
  endedAt?: string;
  /** The page it ended on. */
  url?: string;
}

/** One step of your own model driving a session. */
export interface DriveStep {
  type: "said" | "action" | "screen" | "done" | "error";
  text?: string;
  action?: string;
  /** A screenshot, as a data URL. */
  src?: string;
}
