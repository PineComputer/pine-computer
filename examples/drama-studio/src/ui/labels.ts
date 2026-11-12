// Words for states the engine reports as data, in the maker's language.
import type { EpisodeRow, FileKind, Spend } from "../shared/types.ts";
import { TEMPLATES } from "../shared/presets.ts";
import { ApiError } from "./api.ts";
import type { useT } from "./i18n.ts";

type T = ReturnType<typeof useT>["t"];

export function nowText(row: EpisodeRow, t: T): string {
  switch (row.state) {
    case "queued":
      return t("board.inLine", { n: row.position ?? 1 });
    case "working":
      return row.activity ? plainText(row.activity) : t(row.computer ? "board.atWork" : "board.starting");
    case "waiting":
      return row.waitingFor === "saving" ? t("board.saving") : t("board.waits", { kind: t(`kind.${row.waitingFor ?? "question"}`) });
    case "done":
      return t("board.done");
    case "stopped":
      return row.note ? plainText(row.note) : t("board.stopped");
    default:
      return row.note ? plainText(row.note) : t("board.failed");
  }
}

/**
 * A character's, place's or prop's name as the agent filed it ("maya-reyes", "lin/S1"), said
 * as words ("Maya Reyes", "Lin · S1"). Names in other scripts, and codes like S1, stay as written.
 */
export function subjectName(subject: string): string {
  return subject
    .split("/")
    .map((part) => (/^[a-z][a-z0-9]*(?:[-_ ][a-z0-9]+)*$/.test(part) ? part.split(/[-_ ]+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : part))
    .join(" · ");
}

/** Markdown said as plain words, for a one-line preview: link labels, no markup. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKS: Record<string, Parameters<T>[0]> = { "live action": "look.live", anime: "look.anime", "3D animation": "look.3d" };

function lookLabel(value: string, t: T): string {
  const key = LOOKS[value];
  return key ? t(key) : value;
}

/** What a drama is: its preset template, or for one made before New drama asked for a preset, its look; "" for a rehearsal. */
export function kindLabel(drama: { preset: string; look: string }, t: T): string {
  const template = TEMPLATES.find((entry) => entry.preset !== undefined && entry.preset === drama.preset);
  return template ? t(`template.${template.key}` as Parameters<T>[0]) : lookLabel(drama.look, t);
}

/** What work has cost, in US dollars as Pine prices it; "at least" where some turns couldn't be priced. */
export function moneyText(spent: Spend | number, t: T, lang: string): string {
  const total = typeof spent === "number" ? spent : spent.total;
  const amount = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD" }).format(total);
  return typeof spent !== "number" && spent.partial ? t("spent.atLeast", { amount }) : amount;
}

/** A failure, said in the maker's language: the engine's code where there is one, else its message. */
export function errorText(error: unknown, t: T): string {
  if (error instanceof ApiError) return t(`error.${error.code}`, { detail: error.detail ?? error.message });
  return error instanceof Error ? error.message : String(error);
}

const COMPUTER_STATES = new Set(["starting", "running", "stopping", "stopped", "failed"]);

export function computerState(state: string, t: T): string {
  return COMPUTER_STATES.has(state) ? t(`computer.${state}` as Parameters<T>[0]) : state;
}

export function fileKind(kind: FileKind, t: T): string {
  return t(`file.${kind}`);
}
