// What the studio runs on: the maker's Pine project, the replay, or nothing yet (the app
// then shows its first-run screen). The maker chooses in the app; nothing needs editing.
import type { AppInfo } from "../shared/types.ts";
import { DATA_DIR, VERSION } from "./config.ts";
import { fleet, hasFleet, setFleet, stop } from "./computers.ts";
import { all } from "./db.ts";
import { StudioError } from "./errors.ts";
import type { Fleet, Limits } from "./fleet.ts";
import { publish } from "./live.ts";
import { PineFleet } from "./pine-fleet.ts";
import type { ComputerRow } from "./records.ts";
import { ReplayFleet } from "./replay-fleet.ts";
import { drain, pause, reconcile, resume } from "./scheduler.ts";
import { type PineProject, checkProject, dramaSkill, environmentProject, keyHint, saveMode, saveProject, savedMode, savedProject } from "./settings.ts";

/** At start: the environment's project (a developer's override), the saved one, the replay, or none. */
export function initialFleet(): Fleet | undefined {
  if (process.env.STUDIO_MODE === "replay") return new ReplayFleet();
  const project = environmentProject() ?? savedProject();
  if (project) return new PineFleet(project);
  return savedMode() === "replay" ? new ReplayFleet() : undefined;
}

function use(next: Fleet | undefined, limits?: Limits): void {
  setFleet(next, limits);
  void reconcile();
  publish("app", "dramas", "inbox");
}

export async function connectPine(project: PineProject): Promise<AppInfo> {
  const clean = { endpoint: project.endpoint.trim().replace(/\/$/, ""), apiKey: project.apiKey.trim() };
  // Checking the key reads the project's limits, so connecting doesn't ask for them twice.
  const limits = await checkProject(clean);
  saveProject(clean);
  saveMode(null);
  use(new PineFleet(clean), limits);
  return appInfo();
}

/** Replay, to look around. Not over a connected project: its Computers would be left running. */
export function useReplay(): AppInfo {
  if (hasFleet() && fleet().mode === "pine") {
    throw new StudioError("disconnect-first", "Disconnect your Pine project first; that stops its Computers.", 409);
  }
  saveMode("replay");
  use(new ReplayFleet());
  return appInfo();
}

/**
 * Forgets the project, once none of its Computers is left running on the maker's account.
 * The line pauses, the starts already under way finish, then every Computer is stopped. If
 * one won't stop, the key is kept, so the maker can try again rather than lose track of it.
 */
export async function disconnect(): Promise<AppInfo> {
  pause();
  try {
    if (hasFleet() && fleet().mode === "pine") {
      await drain();
      const live = all<ComputerRow>("select * from computers where mode = 'pine' and state in ('starting', 'running', 'stopping')");
      const results = await Promise.allSettled(live.map((computer) => stop(computer)));
      const stuck = live.filter((_, index) => results[index].status === "rejected");
      if (stuck.length) {
        const names = stuck.map((computer) => computer.label).join(", ");
        throw new StudioError("stop-failed", `Couldn't stop ${names}; your key is kept so you can try again.`, 502, names);
      }
    }
    saveProject(null);
    saveMode(null);
    use(environmentProject() ? new PineFleet(environmentProject()!) : undefined);
  } finally {
    // Only now, with the project's fleet gone, may the clock start things again.
    resume();
  }
  return appInfo();
}

export function appInfo(): AppInfo {
  const fromEnvironment = environmentProject();
  const project = fromEnvironment ?? savedProject();
  const mode = hasFleet() ? fleet().mode : "none";
  return {
    mode,
    version: VERSION,
    dataDir: DATA_DIR,
    project: mode === "pine" && project ? { endpoint: project.endpoint, keyHint: keyHint(project.apiKey), fromEnvironment: Boolean(fromEnvironment) } : undefined,
    dramaSkill: mode === "pine" ? dramaSkill(fleet().project) : undefined,
  };
}
