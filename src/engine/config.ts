// The engine's settings. The maker's Pine project is chosen in the app (settings.ts);
// these are the process's own: where its data lives, where its bundled files are, its
// port, and the limits it keeps. Nothing depends on the directory it was started from.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../../package.json" with { type: "json" };

/** The app's version, as the release and the updater know it. */
export const VERSION: string = packageJson.version;
const APP_NAME = "Pine Drama Studio";

/** Where an installed app keeps its data on each system. */
function standardDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", APP_NAME);
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_NAME);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "pine-drama-studio");
}

/** The studio's records, library and sealing key. Development uses the repository's .data/ (scripts/dev.mjs). */
export const DATA_DIR = path.resolve(process.env.STUDIO_DATA_DIR || standardDataDir());

/** What ships with the studio: the built UI, the replay's recordings and the rehearsal's kit. A packaged app points this at its resources. */
const RESOURCES = path.resolve(process.env.STUDIO_RESOURCES || fileURLToPath(new URL("../..", import.meta.url)));
export const UI_DIR = path.join(RESOURCES, "dist", "ui");
export const FIXTURES = path.join(RESOURCES, "fixtures", "replay");
/** The kit a rehearsal hands each session, to stand in for the drama skill (goals.ts, rehearsed). */
export const REHEARSAL_KIT = path.join(RESOURCES, "fixtures", "rehearsal", "standin.py");

/** 0 asks the system for a free port; the desktop shell does that and reads the port back. */
export const PORT = Number(process.env.STUDIO_PORT ?? 4310);

/**
 * Idle timeouts (docs/IMPLEMENTATION_PLAN.md). Work keeps a Computer running; a question
 * waiting for the maker doesn't, so a Computer with a waiting session gets longer. The
 * working value covers a question that arrives while the app is closed.
 */
export const IDLE_WORKING_S = 60 * 60;
export const IDLE_WAITING_S = 3 * 60 * 60;

/** At most this many episodes wait for the maker before the line stops starting new ones. */
export const WAITING_CAP = 4;

/** Pine's limits on files given to a session and returned by a turn. */
export const MAX_ATTACHMENT = 64 * 1024 * 1024;

/** A turn that ends without a question or a finished episode gets this many "continue" runs. */
export const MAX_CONTINUES = 2;
