// What a check asks the Computer for, and what this app makes of the answer. Pure.
//
// The agent is asked for a short structured reading: a few named things, each copied
// as the page shows it. The next check asks for the same names again, and the two
// readings are compared here, from what this app stored, never by the agent.

import type { Difference, Field } from "@/shared/api";

const PLACES = ["top left", "top centre", "top right", "middle left", "centre", "middle right", "bottom left", "bottom centre", "bottom right"];

/** The job for one check. `labels` are the names the last reading used, if there was one. */
export function goalFor(watch: { what: string; url: string }, labels: string[] = []): string {
  const again = labels.length
    ? `\nRead the same things as the last check, under exactly these names, in this order:\n${labels.map((label) => `- ${label}`).join("\n")}\n`
    : `\nName each thing you read as a person would say it ("Top story", "Pro plan price"): at most six things, only what was asked for.\n`;
  return `Open ${watch.url} in the browser and look at it as a person would. Read this: ${watch.what}
${again}
Report only what the page shows now, each value copied exactly as the page shows it. Leave out anything that changes on every visit and wasn't asked for (counts, ages, timestamps).
Leave the browser on that page, showing the part you read.
If the page asks for a sign-in before it shows this, stop and ask the person to sign in for you. Never type a password yourself.

End your answer with one JSON object in a json code block, and nothing after it:
{"fields": [{"label": "<name>", "value": "<as the page shows it>"}], "place": "<where on the screen you read it: ${PLACES.join(" | ")}>"}`;
}

const clean = (text: unknown) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");

/** The reading in the agent's answer, or null when it holds none. */
export function parseReading(answer: string): { fields: Field[]; place?: string } | null {
  const fenced = [...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].at(-1)?.[1];
  const bare = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
  for (const text of [fenced, bare]) {
    if (!text) continue;
    try {
      const raw = JSON.parse(text) as { fields?: { label?: unknown; value?: unknown }[]; place?: unknown };
      const fields = (raw.fields ?? []).map((f) => ({ label: clean(f.label), value: clean(f.value) })).filter((f) => f.label).slice(0, 6);
      if (!fields.length) continue;
      const place = clean(raw.place).toLowerCase().replace("center", "centre");
      return { fields, ...(PLACES.includes(place) ? { place } : {}) };
    } catch {
      // not JSON: try the next candidate
    }
  }
  return null;
}

/** A name, as two readings would both spell it. */
const name = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** What differs between two stored readings, by name. */
export function compare(before: Field[], after: Field[]): Difference[] {
  const differences: Difference[] = [];
  const then = new Map(before.map((f) => [name(f.label), f]));
  for (const now of after) {
    const was = then.get(name(now.label));
    then.delete(name(now.label));
    if (!was) differences.push({ label: now.label, before: "", after: now.value });
    else if (was.value !== now.value) differences.push({ label: now.label, before: was.value, after: now.value });
  }
  for (const gone of then.values()) differences.push({ label: gone.label, before: gone.value, after: "" });
  return differences;
}

const quote = (value: string) => `“${value.length > 90 ? `${value.slice(0, 88).trimEnd()}…` : value}”`;
const capital = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/** What changed, in one plain sentence. */
export function sentence(differences: Difference[]): string {
  if (differences.length === 1) {
    const [d] = differences;
    if (!d.before) return `${capital(d.label)} is new: ${quote(d.after)}.`;
    if (!d.after) return `${capital(d.label)} is gone. It was ${quote(d.before)}.`;
    return `${capital(d.label)} changed from ${quote(d.before)} to ${quote(d.after)}.`;
  }
  const labels = differences.map((d) => d.label.toLowerCase());
  return `${capital(labels.slice(0, -1).join(", "))} and ${labels.at(-1)} changed.`;
}
