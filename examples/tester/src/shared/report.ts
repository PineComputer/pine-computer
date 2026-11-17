// A run's report as Markdown: the file a developer attaches to an issue. Pure, so the
// page, the export route and the tests share it.

import { host, tally, type Finding, type RunView } from "./api";

type Reported = Pick<RunView, "target" | "checks" | "askedAt" | "state" | "summary" | "findings" | "moments">;

/** The day of a run, where the server is: 2026-11-13. */
function day(at: string): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "saucedemo.com-2026-11-13.md" */
export function fileName(run: Pick<RunView, "target" | "askedAt">): string {
  return `${host(run.target).replace(/[^a-z0-9.-]+/gi, "-")}-${day(run.askedAt)}.md`;
}

/** A person's words inside a table cell or a line: one line, no stray pipes. */
const line = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

function finding(found: Finding): string[] {
  const out = [`### ${found.n}. ${line(found.title)}: ${found.status}`, "", `- **Expected:** ${line(found.expected)}`, `- **Observed:** ${line(found.observed)}`];
  if (found.url) out.push(`- **Where:** ${found.url}${found.where ? ` (${line(found.where)})` : ""}`);
  out.push(found.evidence ? "- **Evidence:** the Computer's screen on that page, saved before the check was recorded (shown in the printed report)" : "- **Evidence:** none; no saved screen shows that page");
  if (found.steps.length) out.push("", "Steps to reproduce:", "", ...found.steps.map((step, i) => `${i + 1}. ${line(step)}`));
  return [...out, ""];
}

export function markdown(run: Reported): string {
  const count = tally(run.findings);
  const failed = run.findings.filter((f) => f.status === "failed");
  const passed = run.findings.filter((f) => f.status === "passed");
  const decided = run.moments.filter((m) => m.kind === "approved" || m.kind === "declined");
  const out = [
    `# Test report: ${host(run.target)}`,
    "",
    `**${count.words}.** Run on ${day(run.askedAt)} against ${run.target}, in a real browser on a Pine Computer.`,
    "",
    "What was asked:",
    "",
    ...run.checks.split("\n").map((text) => `> ${text}`),
    "",
    "| # | Check | Result |",
    "| --- | --- | --- |",
    ...run.findings.map((f) => `| ${f.n} | ${line(f.title)} | ${f.status} |`),
    "",
  ];
  if (run.state !== "completed") out.push(`The run did not finish (${run.state}).${run.summary ? ` ${line(run.summary)}` : ""}`, "");
  for (const moment of decided) out.push(`A person ${moment.kind} the step the run stopped at.`, "");
  if (failed.length) out.push("## Failed", "", ...failed.flatMap(finding));
  if (passed.length) out.push("## Passed", "", ...passed.flatMap(finding));
  return out.join("\n");
}
