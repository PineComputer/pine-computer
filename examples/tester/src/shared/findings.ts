// From what the Computer's agent wrote to what this app shows. The agent records each
// check as a small JSON file; this reads one, tolerantly, and chooses the screen that
// is kept as its evidence. Pure functions, shared with the tests.

import type { Finding, Screen } from "./api";

/** The file a check is recorded in: checks/01.json, checks/02.json… */
export const CHECK_FILE = /^checks\/(\d{1,3})\.json$/;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** One recorded check, or null when the file isn't one. A model may wrap its JSON in a code fence. */
export function parseCheck(raw: string, n: number): Omit<Finding, "at" | "screens" | "evidence"> | null {
  const body = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let found: Record<string, unknown>;
  try {
    found = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  const title = text(found.title);
  const status = text(found.status).toLowerCase();
  if (!title || (status !== "passed" && status !== "failed")) return null;
  return {
    n,
    title,
    status,
    expected: text(found.expected),
    observed: text(found.observed),
    url: text(found.url),
    where: text(found.where),
    steps: Array.isArray(found.steps) ? found.steps.map(text).filter(Boolean) : [],
  };
}

/** Two addresses name one page: the same origin and path, whatever follows. */
export function samePage(a: string | undefined, b: string | undefined): boolean {
  const page = (value: string | undefined) => {
    try {
      const url = new URL(value ?? "");
      return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return null;
    }
  };
  const left = page(a);
  return left !== null && left === page(b);
}

/**
 * The screens that belong to a check, from those saved up to the moment it was
 * recorded. `screens` are the ones taken since the check before it (at least the last
 * one, when the check needed no new step). The evidence is the last screen that shows
 * the page the finding names: a finding is shown beside a picture of that page, or
 * beside none. The agent's word alone never picks the picture.
 */
export function evidenceFor(finding: Pick<Finding, "url">, saved: Screen[], since: number): { screens: string[]; evidence?: string } {
  const fresh = saved.slice(since);
  const own = fresh.length ? fresh : saved.slice(-1);
  const evidence = saved.findLast((screen) => samePage(screen.url, finding.url));
  const screens = own.map((screen) => screen.name);
  if (evidence && !screens.includes(evidence.name)) screens.unshift(evidence.name);
  return { screens, evidence: evidence?.name };
}
