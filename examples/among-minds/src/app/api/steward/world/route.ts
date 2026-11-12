import { body, HttpError, route } from "@/server/http";
import { updateConfig, config, type Config } from "@/engine/config";
import { halt } from "@/engine/episodes";
import { record } from "@/engine/record";

export const dynamic = "force-dynamic";

export const GET = route(async () => config());

/** Pause or resume the world, stop everything now, or change its dials. */
export const POST = route(async (request) => {
  const input = await body<{ action?: string; config?: Partial<Config> }>(request);
  if (input.action === "pause" || input.action === "resume") {
    updateConfig({ paused: input.action === "pause" });
    record("steward", `world-${input.action}`, input.action === "pause" ? "A steward paused the world." : "A steward resumed the world.");
  } else if (input.action === "halt") {
    updateConfig({ paused: true });
    await halt();
    record("steward", "world-halt", "A steward stopped everything: turns cancelled, every home put to sleep.");
  } else if (input.config) {
    const allowed: (keyof Config)[] = ["allowance", "dayBudget", "episodeReserve", "episodeMaxMinutes", "maxAwake", "maxPrice", "settleAfterHours"];
    const change: Partial<Config> = {};
    for (const key of allowed) {
      const value = input.config[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new HttpError(400, `${key} must be a number.`);
      (change as Record<string, number>)[key] = value;
    }
    updateConfig(change);
    record("steward", "config", "A steward changed the habitat's dials.", { data: change });
  } else throw new HttpError(400, "Choose pause, resume or halt, or send config.");
  return config();
});
