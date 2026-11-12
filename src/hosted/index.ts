// One service for many projects (PINE_HOSTED=1). `pine-computer serve` is for one person, with their key in
// the environment. Here the bearer token is the caller's own project key: it is checked with the platform,
// held in memory only, and each request runs in that project's scope. Nothing in this folder is loaded by
// the CLI otherwise. docs/hosting.md says how to run it.

import { createHash, createHmac } from "node:crypto";
import { Client } from "@pinesandbox/computer";
import { useStore, type Scope } from "../core/store.js";
import { postgres } from "./postgres.js";

export interface Hosted {
  /** The scope a bearer token opens, or null when the platform refuses the key. */
  project(key: string): Promise<Scope | null>;
  /** A project's scope from the name a signed link carries, for a process that hasn't seen its key. */
  scopeOf(project: string): Scope;
  /** A signature over a few names, for a link that grants exactly those and nothing beside them. */
  sign(...names: string[]): string;
}

/** How long a checked key is trusted before it is checked again: a revoked key stops working within this. */
const CHECK_MS = 5 * 60_000;
const KNOWN_MAX = 5000;

export async function hosted(): Promise<Hosted> {
  const endpoint = process.env.PINE_SANDBOX_ENDPOINT;
  if (!endpoint) throw new Error("PINE_HOSTED needs PINE_SANDBOX_ENDPOINT: the platform every project's key is for.");
  const secret = Buffer.from(process.env.PINE_STORE_KEY ?? "", "base64");
  if (secret.length !== 32) throw new Error("PINE_HOSTED needs PINE_STORE_KEY: 32 random bytes in base64, which seals what is stored and signs the links.");
  if (process.env.PINE_DATABASE_URL) useStore(await postgres(process.env.PINE_DATABASE_URL, secret));

  // The name records are kept under. It is the key's, not the project's: the platform doesn't yet name the
  // project a key belongs to, so a project that changes its key starts with a new Computer.
  const nameOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);
  const known = new Map<string, { scope: Promise<Scope | null>; until: number }>();
  const seen = new Map<string, Scope>();

  return {
    project(key) {
      const project = nameOf(key);
      const held = known.get(project);
      if (held && held.until > Date.now()) return held.scope;
      const client = seen.get(project)?.client ?? new Client({ endpoint, apiKey: key });
      const checked = client.projectPolicy().then(
        () => {
          const s = { project, client };
          seen.set(project, s);
          return s;
        },
        (error: Error & { status?: number }) => {
          known.delete(project);
          if (error.status !== 401 && error.status !== 403) throw error;
          seen.delete(project);
          return null;
        },
      );
      // Bounded: a caller trying keys can't grow it without end.
      if (known.size >= KNOWN_MAX) {
        const oldest = known.keys().next().value!;
        known.delete(oldest);
        seen.delete(oldest);
      }
      known.set(project, { scope: checked, until: Date.now() + CHECK_MS });
      return checked;
    },
    // The link is signed, so the project is real. Without its key the Computer's own records still reach a
    // conversation, which is enough to show its desktop and take its controls.
    scopeOf: (project) => seen.get(project) ?? { project, client: new Client({ endpoint, apiKey: "pk_none" }) },
    sign: (...names) => createHmac("sha256", secret).update(JSON.stringify(names)).digest("base64url").slice(0, 27),
  };
}
