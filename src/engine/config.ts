// The habitat's dials. Stewards change them in the steward room; these are the defaults.

import { setSetting, setting } from "./db";

export interface Config {
  /** The world is paused: no wakings, no jobs. */
  paused: boolean;
  /** Energy every resident receives each world day, in dollars. */
  allowance: number;
  /** The most the whole habitat may spend in a world day, in dollars. */
  dayBudget: number;
  /** What one waking may spend at most: reserved before it starts. */
  episodeReserve: number;
  /** How long one waking may run on its computer. */
  episodeMaxMinutes: number;
  /** Homes awake at once (Pine's limit on running Computers). */
  maxAwake: number;
  /** The highest price a contract or skill may carry. */
  maxPrice: number;
  /** Hours before a delivery nobody answered pays the seller. */
  settleAfterHours: number;
}

const DEFAULTS: Config = {
  paused: false,
  allowance: 1,
  dayBudget: 10,
  episodeReserve: 0.4,
  episodeMaxMinutes: 10,
  maxAwake: 2,
  maxPrice: 2,
  settleAfterHours: 12,
};

export function config(): Config {
  const saved = setting("config");
  return saved ? { ...DEFAULTS, ...(JSON.parse(saved) as Partial<Config>) } : DEFAULTS;
}

export function updateConfig(change: Partial<Config>): Config {
  const next = { ...config(), ...change };
  setSetting("config", JSON.stringify(next));
  return next;
}
