// What the runs hand back, checked. A run on a Computer returns its result as a small
// JSON file (the planner's angles, a reader's notes, the writer's report); nothing in it
// is trusted until it has been read here. Above all, a source is a page a reader's
// browser really opened: a claim that cites any other address is dropped.

import type { Angle, Report, Source } from "./api";
import { hostOf } from "./steps";

/** The first JSON object in a text: a file's contents, or an answer that wraps one in prose. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : []);

/** The planner's angles: two or three, each a title and what to find out. */
export function anglesFrom(value: unknown): Angle[] {
  return list((value as { angles?: unknown })?.angles)
    .map((a, i) => ({ id: `a${i + 1}`, title: str(a.title, 80), focus: str(a.focus, 400) }))
    .filter((a) => a.title)
    .slice(0, 3);
}

export interface Finding {
  text: string;
  url: string;
}

export interface Notes {
  summary: string;
  findings: Finding[];
}

export function notesFrom(value: unknown): Notes | undefined {
  const notes = value as { summary?: unknown; findings?: unknown };
  const findings = list(notes?.findings)
    .map((f) => ({ text: str(f.text ?? f.claim, 600), url: str(f.url ?? f.source, 2000) }))
    .filter((f) => f.text && f.url);
  return findings.length ? { summary: str(notes.summary, 1200), findings } : undefined;
}

/** An address as two pages are compared: no scheme, www, fragment or trailing slash. */
export function sameAs(url: string, loose = false): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}${loose ? "" : u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** A page a reader opened, with the name of the saved picture of it. */
export interface Page {
  url: string;
  title: string;
  shot: string;
}

/** One reader's part of a brief, as the sources are built from it. */
export interface Reading {
  run: string;
  reader: string;
  angle: Angle;
  pages: Page[];
  notes?: Notes;
}

export interface Cited {
  angle: Angle;
  summary: string;
  findings: { text: string; n: number }[];
  /** Claims left out because their page was never opened. */
  dropped: number;
}

/**
 * Numbers the sources: each page a reader opened and cited, once, in the order the
 * notes cite them. A claim whose address matches no opened page is dropped.
 */
export function cite(readings: readonly Reading[]): { sources: Source[]; cited: Cited[] } {
  const sources: Source[] = [];
  const cited = readings.map((reading) => {
    const out: Cited = { angle: reading.angle, summary: reading.notes?.summary ?? "", findings: [], dropped: 0 };
    for (const finding of reading.notes?.findings ?? []) {
      const page = reading.pages.find((p) => sameAs(p.url) === sameAs(finding.url)) ?? reading.pages.find((p) => sameAs(p.url, true) === sameAs(finding.url, true));
      if (!page) {
        out.dropped += 1;
        continue;
      }
      let source = sources.find((s) => sameAs(s.url) === sameAs(page.url));
      if (!source) {
        source = { n: sources.length + 1, url: page.url, title: page.title || hostOf(page.url), host: hostOf(page.url), run: reading.run, shot: page.shot, reader: reading.reader, angle: reading.angle.id };
        sources.push(source);
      }
      out.findings.push({ text: finding.text, n: source.n });
    }
    return out;
  });
  return { sources, cited };
}

const CITE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Keeps the citations that name a source, one bracket each, and removes the rest. */
export function checkCites(text: string, count: number): string {
  return text.replace(CITE, (_all, inner: string) =>
    inner
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => n >= 1 && n <= count)
      .map((n) => `[${n}]`)
      .join(""),
  );
}

/** The writer's report, with its citations checked against the numbered sources. */
export function reportFrom(value: unknown, angles: readonly Angle[], sources: Source[]): Report | undefined {
  const raw = value as { title?: unknown; answer?: unknown; sections?: unknown };
  const answer = checkCites(str(raw?.answer, 2000), sources.length);
  const sections = list(raw?.sections)
    .map((s, i) => {
      const angle = angles.find((a) => a.id === s.angle) ?? angles[i];
      return angle ? { angle: angle.id, title: angle.title, body: checkCites(str(s.body, 6000), sources.length) } : undefined;
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s?.body));
  if (!answer || !sections.length) return undefined;
  return { title: str(raw.title, 140), answer, sections, sources };
}

/** The report as a Markdown file. */
export function markdown(question: string, report: Report, readerName: (id: string) => string): string {
  const lines = [`# ${report.title || question}`, "", `> ${question}`, "", "## Short answer", "", report.answer, ""];
  for (const section of report.sections) lines.push(`## ${section.title}`, "", section.body, "");
  lines.push("## Sources", "", "Every source is a page a reader opened while it worked.", "");
  for (const source of report.sources) lines.push(`${source.n}. [${source.title.replace(/[[\]]/g, "")}](${source.url}) · ${source.host} · opened by ${readerName(source.reader)}`);
  return `${lines.join("\n")}\n`;
}
