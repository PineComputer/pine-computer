// Which Pine project the studio uses, chosen in the app: the maker pastes the project's
// endpoint and key once, the studio checks them with Pine and keeps the key sealed. The
// environment (PINE_SANDBOX_*) still works, as a developer's override.
import { Client } from "@pinesandbox/computer";
import { get, run } from "./db.ts";
import { StudioError } from "./errors.ts";
import type { Limits } from "./fleet.ts";
import { limitsOf } from "./pine-fleet.ts";
import { seal, unseal } from "./seal.ts";

export const DEFAULT_ENDPOINT = "https://pinesandbox.io";

export interface PineProject {
  endpoint: string;
  apiKey: string;
  /** The SDK's controlHost, for a Pine run locally (`./pine dev`); from the environment only. */
  controlHost?: string;
}

function read(key: string): string | undefined {
  return get<{ value: string }>("select value from settings where key = ?", key)?.value;
}

function write(key: string, value: string | null): void {
  if (value === null) run("delete from settings where key = ?", key);
  else run("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", key, value);
}

export function environmentProject(): PineProject | undefined {
  const apiKey = process.env.PINE_SANDBOX_API_KEY;
  const controlHost = process.env.PINE_SANDBOX_CONTROL_HOST;
  return apiKey ? { endpoint: process.env.PINE_SANDBOX_ENDPOINT || DEFAULT_ENDPOINT, apiKey, ...(controlHost ? { controlHost } : {}) } : undefined;
}

export function savedProject(): PineProject | undefined {
  const sealed = read("pine.project");
  return sealed ? (JSON.parse(unseal(sealed)) as PineProject) : undefined;
}

export function saveProject(project: PineProject | null): void {
  write("pine.project", project ? seal(JSON.stringify(project)) : null);
}

/** "replay" once the maker chose to look around without a project. */
export function savedMode(): "replay" | undefined {
  return read("mode") === "replay" ? "replay" : undefined;
}

export function saveMode(mode: "replay" | null): void {
  write("mode", mode);
}

/** Whether the project (Fleet.project) offers Pine's drama skill, as its Computers last said; unknown until one did. */
export function dramaSkill(project: string): "offered" | "missing" | undefined {
  const value = read(`skill.${project}`);
  return value === "offered" || value === "missing" ? value : undefined;
}

/** Remembers what a Computer of the project said; whether that changed what was known. */
export function noteDramaSkill(project: string, offered: boolean): boolean {
  const value = offered ? "offered" : "missing";
  if (read(`skill.${project}`) === value) return false;
  write(`skill.${project}`, value);
  return true;
}

/** Enough of a key to recognise it, never enough to use it. */
export function keyHint(apiKey: string): string {
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

/** Asks Pine whether the project accepts this key, without starting anything, and returns the project's limits. */
export async function checkProject(project: PineProject): Promise<Limits> {
  let endpoint: URL;
  try {
    endpoint = new URL(project.endpoint);
  } catch {
    throw new StudioError("endpoint-invalid", "That endpoint isn't a web address.");
  }
  if (!project.apiKey.trim()) throw new StudioError("key-missing", "Paste your project's API key.");
  try {
    return limitsOf(await new Client({ endpoint: endpoint.toString().replace(/\/$/, ""), apiKey: project.apiKey.trim(), controlHost: project.controlHost }).projectPolicy());
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) throw new StudioError("key-rejected", "Pine didn't accept that key. Copy it again from the console: Project → API keys.");
    throw new StudioError("pine-unreachable", `Couldn't reach Pine at ${endpoint.host}: ${(error as Error).message}`, 502, `${endpoint.host}: ${(error as Error).message}`);
  }
}
