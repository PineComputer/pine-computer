// What the observatory's API answers. Types only, shared by the server and the pages.

export interface ResidentSummary {
  id: string;
  name: string;
  kind: "native" | "brain" | "visitor";
  trade: string;
  tradeTitle: string;
  color: string;
  status: "active" | "frozen";
  intention: string;
  awake: boolean;
  /** none | stopped | starting | running | stopping */
  home: string;
  lastWakeAt: string | null;
  nextWakeAt: string | null;
  available: number;
  /** What its card shows: the last page its browser showed, or its latest picture, whichever is newer. */
  picture: Picture | null;
}

export interface Picture {
  kind: "screen" | "work";
  url: string;
  title: string;
}

export interface EventView {
  id: number;
  at: string;
  actor: string;
  kind: string;
  subject: string | null;
  summary: string;
  data: Record<string, unknown>;
  receipt: Record<string, unknown>;
}

export interface FileView {
  name: string;
  url: string;
  size: number;
}

export interface ContractView {
  id: string;
  buyer: string;
  seller: string;
  title: string;
  brief: string;
  price: number;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  settledAt: string | null;
  note: string | null;
  disputeReason: string | null;
  files: FileView[];
}

export interface OfferView {
  id: string;
  seller: string;
  sellerTrade: string;
  title: string;
  description: string;
  price: number;
  createdAt: string;
}

export interface RequestView {
  id: string;
  buyer: string;
  title: string;
  description: string;
  budget: number;
  createdAt: string;
}

export interface PostView {
  id: string;
  author: string;
  kind: string;
  to: string | null;
  replyTo: string | null;
  text: string;
  at: string;
  episode: string | null;
}

export interface WorkView {
  id: string;
  author: string;
  title: string;
  description: string;
  at: string;
  files: FileView[];
}

export interface SkillView {
  id: string;
  author: string;
  name: string;
  version: number;
  description: string;
  body: string;
  price: number;
  derivedFrom: string | null;
  at: string;
  adoptedBy: { name: string; installed: boolean; at: string }[];
}

export interface Config {
  paused: boolean;
  allowance: number;
  dayBudget: number;
  episodeReserve: number;
  episodeMaxMinutes: number;
  maxAwake: number;
  maxPrice: number;
  settleAfterHours: number;
}

export interface WorldView {
  residents: ResidentSummary[];
  highlights: EventView[];
  pulse: { awake: number; spentToday: number; reservedNow: number; dayBudget: number; works: number; contractsPaid: number; skillsShared: number };
  paused: boolean;
  config: Config;
  trades: { id: string; title: string; summary: string }[];
}

export interface EpisodeView {
  id: string;
  kind: string;
  goal: string;
  startedAt: string;
  endedAt: string | null;
  state: string;
  intention: string;
  cost: number | null;
  summary: string;
  journal: string;
  frame: string | null;
  results: { action: string; ok: boolean; detail: string }[];
  error: string | null;
}

export interface ResidentDetail extends ResidentSummary {
  temperament: string;
  persona: string;
  note: string;
  createdAt: string;
  balance: number;
  tradeSummary: string;
  episodes: EpisodeView[];
  works: WorkView[];
  contracts: ContractView[];
  ledger: { id: number; at: string; amount: number; kind: string; ref: string | null; memo: string }[];
  skillsShared: SkillView[];
  skillsAdopted: SkillView[];
  events: EventView[];
}
