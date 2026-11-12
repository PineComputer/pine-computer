// Browsing a drama outside its reviews: an episode's work receipt by receipt, the script,
// what can be delivered, and the cast. Read only: the maker decides in reviews, and these
// pages show what was decided on, which covers the group a review showed, never one file of
// it (a verdict on seg03's takes is not a choice among them). Files are grouped by path
// hints; whatever isn't recognised is still listed (docs/IMPLEMENTATION_PLAN.md, rule 5).
import type { CastCard, Decision, DeliveryRow, EpisodePage, Judged, Receipt, ReviewKind, ScriptPage, SegmentPage } from "../shared/types.ts";
import { classify } from "./classify.ts";
import { all, get } from "./db.ts";
import { readFileSync } from "node:fs";
import { type FileRow, blobPath, itemIn, toItem } from "./library.ts";
import type { ZipEntry } from "./zip.ts";
import { type EpisodeRow, type ReviewRow, drama as dramaRow, episodeCode } from "./records.ts";
import { itemsOf, placeKey } from "./reviews.ts";
import { episodeViews } from "./views.ts";

/** The decision a review recorded on one of the items it showed. */
function judged(review: ReviewRow | undefined, key: string): Judged | undefined {
  if (!review) return undefined;
  const decision = review.decision ? (JSON.parse(review.decision) as Decision) : undefined;
  const entry = decision?.items.find((item) => item.key === key);
  return { reviewId: review.id, kind: review.kind, state: review.state, verdict: entry?.verdict, notes: entry?.notes ?? [] };
}

/** Files by the turn that returned them, in the order they arrived. */
function byTurn(rows: FileRow[]): [string, FileRow[]][] {
  const turns = new Map<string, FileRow[]>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = row.turn_id ?? `file-${row.id}`;
    turns.set(key, [...(turns.get(key) ?? []), row]);
  }
  return [...turns.entries()];
}

function reviewsByTurn(where: string, id: string): Map<string, ReviewRow> {
  return new Map(all<ReviewRow>(`select * from reviews where ${where} = ?`, id).map((review) => [review.turn_id, review]));
}

const newestFirst = (receipts: Receipt[]) => receipts.reverse();

/** One episode: each segment's storyboards and takes, the cut's versions, the breakdown, and the rest. */
export function episodePage(dramaId: string, code: string): EpisodePage | undefined {
  const drama = dramaRow(dramaId);
  const episode = drama && all<EpisodeRow>("select * from episodes where drama_id = ? order by number", dramaId).find((row) => episodeCode(row) === code);
  if (!drama || !episode) return undefined;
  const rows = episodeViews(dramaId);
  const index = rows.findIndex((row) => row.id === episode.id);
  const files = all<FileRow>("select * from files where episode_id = ? and kind != 'archive' order by id", episode.id);
  const reviews = reviewsByTurn("episode_id", episode.id);
  const item = itemIn(code);

  const breakdown = files.findLast((file) => file.kind === "breakdown" && file.type.startsWith("text/"));
  const shown = new Set<number>();
  const segments = new Map<string, SegmentPage>();
  const segment = (key: string) => segments.get(key) ?? segments.set(key, { key, boards: [], stills: [], takes: [] }).get(key)!;
  const cuts: Receipt[] = [];
  for (const [turnId, turnFiles] of byTurn(files)) {
    const review = reviews.get(turnId);
    for (const kind of ["storyboards", "takes", "cut"] as const satisfies ReviewKind[]) {
      for (const group of itemsOf(kind, turnFiles).items) {
        const receipt = (files: Receipt["files"]): Receipt => ({ turnId, files, review: judged(review?.kind === kind ? review : undefined, group.key) });
        for (const file of group.files) shown.add(file.id);
        if (kind === "cut") cuts.push(receipt(group.files));
        else if (kind === "takes") segment(group.key).takes.push(receipt(group.files));
        else {
          // The storyboards apart from the blocking and first-frame references they are drawn from, each in its own tab.
          const boards = group.files.filter((file) => file.kind === "storyboard");
          const stills = group.files.filter((file) => file.kind !== "storyboard");
          if (boards.length) segment(group.key).boards.push(receipt(boards));
          if (stills.length) segment(group.key).stills.push(receipt(stills));
        }
      }
    }
  }
  for (const page of segments.values()) {
    newestFirst(page.boards);
    newestFirst(page.stills);
    newestFirst(page.takes);
  }
  return {
    dramaId,
    dramaTitle: drama.title,
    format: drama.format,
    row: rows[index],
    previous: rows[index - 1]?.code,
    next: rows[index + 1]?.code,
    breakdown: breakdown ? item(breakdown) : undefined,
    segments: [...segments.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    cuts: newestFirst(cuts),
    other: files.filter((file) => !shown.has(file.id)).reverse().map(item),
  };
}

/**
 * The newest screenplay version drama-cli recorded (the highest vN), with its rewrite review, and whether the
 * question that brought it still waits for the maker. Read from each file's path, so files saved before these
 * kinds existed count too.
 */
function currentScreenplay(dramaId: string): ScriptPage["screenplay"] {
  const found = all<FileRow>("select * from files where drama_id = ? and type like 'text/%' order by id", dramaId)
    .map((row) => ({ row, hints: classify(row.rel_path) }))
    .filter(({ hints }) => hints.kind === "screenplay-version" || hints.kind === "screenplay-review");
  const number = (version?: string) => Number(version?.slice(1) ?? 0);
  const newest = Math.max(0, ...found.map(({ hints }) => number(hints.version)));
  if (!newest) return undefined;
  const of = (kind: string) => found.findLast(({ hints }) => hints.kind === kind && number(hints.version) === newest)?.row;
  const file = of("screenplay-version");
  const review = of("screenplay-review");
  const turns = [file, review].flatMap((row) => (row?.turn_id ? [row.turn_id] : []));
  const pending = turns.some((turnId) => all<ReviewRow>("select * from reviews where turn_id = ? and state in ('saving', 'open', 'sending')", turnId).length > 0);
  return { version: `v${newest}`, file: file && toItem(file), review: review && toItem(review), pending };
}

/** The drama as text: what the maker gave, the newest bible, and each episode's newest breakdown, listed or not yet. */
export function scriptPage(dramaId: string): ScriptPage {
  const inputs = all<FileRow>("select f.* from files f join inputs i on i.file_id = f.id where i.drama_id = ? order by f.id", dramaId);
  const texts = all<FileRow>("select * from files where drama_id = ? and kind in ('bible', 'breakdown') and type like 'text/%' order by id", dramaId);
  const titles = new Map(all<EpisodeRow>("select * from episodes where drama_id = ?", dramaId).map((row) => [episodeCode(row), row.title]));
  const breakdowns = new Map<string, FileRow>();
  for (const row of texts) {
    const code = row.kind === "breakdown" ? classify(row.rel_path).episode : undefined;
    if (code) breakdowns.set(code, row);
  }
  const bible = texts.findLast((row) => row.kind === "bible");
  return {
    inputs: inputs.map(toItem),
    screenplayFile: get<{ screenplay_file: number | null }>("select screenplay_file from dramas where id = ?", dramaId)?.screenplay_file ?? null,
    screenplay: currentScreenplay(dramaId),
    bible: bible ? toItem(bible) : undefined,
    breakdowns: [...breakdowns.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, row]) => ({ code, title: titles.get(code) || undefined, file: itemIn(code)(row) })),
  };
}

/**
 * Each episode's latest cut with its own review, and the cut the maker approved where that
 * is known for certain: the one cut its newest approved cut review showed. A review that
 * showed several cuts approves no single one of them.
 */
export function deliveryRows(dramaId: string): DeliveryRow[] {
  return all<EpisodeRow>("select * from episodes where drama_id = ? order by number", dramaId).map((episode) => {
    const code = episodeCode(episode);
    const item = itemIn(code);
    const cuts = all<FileRow>("select * from files where episode_id = ? and kind = 'cut' order by id", episode.id);
    const latest = cuts.at(-1);
    const reviews = all<ReviewRow>("select * from reviews where episode_id = ? and kind = 'cut' order by created_at desc", episode.id);
    const approved = reviews.find((review) => review.state === "answered" && judged(review, "cut")?.verdict === "approve");
    const shown = approved ? cuts.filter((cut) => cut.turn_id === approved.turn_id) : [];
    return {
      episodeId: episode.id,
      code,
      title: episode.title,
      state: episode.state,
      latest: latest
        ? {
            file: item(latest),
            review: judged(reviews.find((review) => review.turn_id === latest.turn_id), "cut"),
            together: cuts.filter((cut) => cut.turn_id === latest.turn_id).length,
          }
        : undefined,
      // An episode the maker finished without a cut review is delivered with its latest cut.
      accepted: shown.length === 1 ? item(shown[0]) : !approved && episode.state === "done" && latest ? item(latest) : undefined,
      ambiguous: shown.length > 1 || undefined,
    };
  });
}

/** A name that is safe as a file or folder name on every system. */
function fileName(text: string): string {
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

/** The season as delivered: every episode's approved cut, named by episode, in a folder named for the drama. */
export function seasonEntries(dramaId: string): { title: string; entries: ZipEntry[] } {
  const drama = dramaRow(dramaId);
  const title = fileName(drama?.title ?? "drama");
  const entries = deliveryRows(dramaId).flatMap((row) => {
    const file = row.accepted && all<FileRow>("select * from files where id = ?", row.accepted.id)[0];
    if (!file) return [];
    const ext = file.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "";
    return [{ name: `${title}/${fileName([row.code, row.title].filter(Boolean).join(" "))}${ext}`, path: blobPath(file.sha), size: file.size }];
  });
  return { title, entries };
}

/** A breakdown's text, from the library; empty if it can't be read. */
function textOf(fileId: number): string {
  const row = all<FileRow>("select * from files where id = ?", fileId)[0];
  try {
    return row ? readFileSync(blobPath(row.sha), "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * Whether a breakdown names a character, place or prop: by the id its files are kept under
 * (lin, 林晚, engine-room), that id as words (engine room), or for a character a first name
 * of four letters or more (MAYA_REYES as Maya). Only whole names count, so a loose mention
 * may be missed rather than invented; Chinese, written without spaces, counts anywhere.
 */
function names(text: string, subject: string, character: boolean): boolean {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = subject.split(/[-_\s]+/).filter(Boolean);
  const forms = [subject, words.join(" "), character && words.length > 1 && words[0].length >= 4 ? words[0] : ""];
  return forms
    .filter((form, index) => form && forms.indexOf(form) === index)
    .some((form) => (/\p{Script=Han}/u.test(form) ? text.includes(form) : new RegExp(`(^|[^\\p{L}\\p{N}])${escape(form)}($|[^\\p{L}\\p{N}])`, "iu").test(text)));
}

/** Characters with every version of each look (base first), then places and props, each version with its verdict. */
export function castCards(dramaId: string): CastCard[] {
  const files = all<FileRow>("select * from files where drama_id = ? and kind in ('look', 'location', 'prop') and type like 'image/%' order by id", dramaId);
  const reviews = reviewsByTurn("drama_id", dramaId);
  const cards = new Map<string, CastCard>();
  const seen = new Map<string, Receipt>();
  for (const [turnId, turnFiles] of byTurn(files)) {
    const review = reviews.get(turnId);
    for (const file of turnFiles) {
      const subject = file.subject ?? file.name;
      const kind = file.kind as CastCard["kind"];
      // A character's look (base, S1…), or a place's time of day (Night), which is "" for its plate.
      const look = kind === "look" ? file.look ?? "base" : file.look ?? "";
      // The key the review knew this item by: a character's look, or a place or prop.
      const key = kind === "look" ? (look === "base" ? subject : `${subject}/${look}`) : placeKey({ kind, subject, look });
      const card = cards.get(`${kind}|${subject}`) ?? cards.set(`${kind}|${subject}`, { kind, subject, looks: [], episodes: [] }).get(`${kind}|${subject}`)!;
      let entry = card.looks.find((candidate) => candidate.look === look);
      if (!entry) card.looks.push((entry = { look, versions: [] }));
      // Only a review of looks or of the shared references judged these.
      const looked = review && (review.kind === "looks" || review.kind === "references") ? review : undefined;
      const verdict = judged(looked, looked?.kind === "looks" ? subject : key);
      // The same picture returned again (with the shared references, say) is the same version; a later verdict on it is the one that holds.
      const again = seen.get(`${kind}|${subject}|${look}|${file.sha}`);
      if (again) {
        if (verdict?.verdict) again.review = verdict;
        continue;
      }
      let receipt = entry.versions.find((version) => version.turnId === turnId);
      if (receipt) receipt.files.push(toItem(file));
      else entry.versions.push((receipt = { turnId, files: [toItem(file)], review: verdict }));
      seen.set(`${kind}|${subject}|${look}|${file.sha}`, receipt);
    }
  }
  const order = { look: 0, location: 1, prop: 2 };
  const breakdowns = scriptPage(dramaId).breakdowns.map((entry) => ({ code: entry.code, text: textOf(entry.file.id) }));
  return [...cards.values()]
    .map((card) => ({
      ...card,
      episodes: breakdowns.filter((entry) => names(entry.text, card.subject, card.kind === "look")).map((entry) => entry.code),
      looks: card.looks
        .sort((a, b) => (a.look === "base" ? -1 : b.look === "base" ? 1 : a.look.localeCompare(b.look, undefined, { numeric: true })))
        .map((entry) => ({ ...entry, versions: entry.versions.reverse() })),
    }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.subject.localeCompare(b.subject));
}

