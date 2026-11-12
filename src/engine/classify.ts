// What a returned file probably is, from its path. Pine guarantees a file's path, size,
// hash and type, not what it shows, so these are hints: every screen also works from the
// agent's own words and the plain file list (docs/IMPLEMENTATION_PLAN.md, rule 5). The
// patterns follow the folders the drama skill writes, wherever they sit in the path.
import type { FileKind } from "../shared/types.ts";

export interface Hints {
  kind: FileKind;
  episode?: string;
  segment?: string;
  subject?: string;
  look?: string;
  style?: string;
  version?: string;
}

const IMAGE = String.raw`\.(?:png|jpe?g|webp|svg)$`;
const VIDEO = String.raw`\.(?:mp4|mov|webm)$`;
const SEG = String.raw`(seg\d+[a-z]?)`;
// A segment picture's version holds its output as image-1.<ext> (short_drama drama_cli/stages.py, `_image_file`), beside
// the inputs drama-cli cropped for the request: a blocking reference's view.png, a panel edit's crop.png and
// edited-panel.png (stages.py, VIEW, CROP and EDITED). Only the output is the picture; the rest is what it was made from.
const OUTPUT = String.raw`image-1${IMAGE}`;

const VER = String.raw`(v\d+)`;

const RULES: [RegExp, (m: RegExpMatchArray) => Hints][] = [
  [/(?:^|\/)handoff\/(EP\d+|project)\.tar\.part-[a-z0-9]+$/i, (m) => ({ kind: "archive", episode: /^EP/i.test(m[1]) ? m[1] : undefined })],
  [/(?:^|\/)handoff\/status\.json$/i, () => ({ kind: "status" })],
  [/(?:^|\/)handoff\/lineage\.json$/i, () => ({ kind: "lineage" })],
  [/(?:^|\/)handoff\/infinite-canvas\.zip$/i, () => ({ kind: "infinite-canvas" })],
  [/(?:^|\/)handoff\/refusals\.jsonl$/i, () => ({ kind: "refusal" })],
  [new RegExp(String.raw`episodes/(EP\d+)/edit/${VER}/[^/]+${VIDEO}`, "i"), (m) => ({ kind: "cut", episode: m[1], version: m[2] })],
  [new RegExp(String.raw`episodes/(EP\d+)/segments/${SEG}/(t\d+)/[^/]+${VIDEO}`, "i"), (m) => ({ kind: "take", episode: m[1], segment: m[2], version: m[3] })],
  [
    new RegExp(String.raw`episodes/(EP\d+)/multi_panel_storyboard/${SEG}/([^/]+)/${VER}/${OUTPUT}`, "i"),
    (m) => ({ kind: "storyboard", episode: m[1], segment: m[2], style: m[3], version: m[4] }),
  ],
  [new RegExp(String.raw`episodes/(EP\d+)/blocking/${SEG}/${VER}/${OUTPUT}`, "i"), (m) => ({ kind: "blocking", episode: m[1], segment: m[2], version: m[3] })],
  [
    new RegExp(String.raw`episodes/(EP\d+)/first_frame_reference/${SEG}/${VER}/${OUTPUT}`, "i"),
    (m) => ({ kind: "frame", episode: m[1], segment: m[2], version: m[3] }),
  ],
  [new RegExp(String.raw`episodes/(EP\d+)/asr_align/${VER}/[^/]+\.srt$`, "i"), (m) => ({ kind: "subtitles", episode: m[1], version: m[2] })],
  // The breakdown itself; script.md beside it is the episode's screenplay lines, copied.
  [new RegExp(String.raw`episodes/(EP\d+)/breakdown/${VER}/breakdown\.(?:md|json)$`, "i"), (m) => ({ kind: "breakdown", episode: m[1], version: m[2] })],
  [
    new RegExp(String.raw`assets/characters/([^/]+)/states/([^/]+)/${VER}/[^/]+${IMAGE}`, "i"),
    (m) => ({ kind: "look", subject: m[1], look: m[2], version: m[3] }),
  ],
  [new RegExp(String.raw`assets/characters/([^/]+)/${VER}/[^/]+${IMAGE}`, "i"), (m) => ({ kind: "look", subject: m[1], look: "base", version: m[2] })],
  // A place at another time of day (Night) is drawn from its plate and kept under times/.
  [new RegExp(String.raw`assets/scenes/([^/]+)/times/([^/]+)/${VER}/[^/]+${IMAGE}`, "i"), (m) => ({ kind: "location", subject: m[1], look: m[2], version: m[3] })],
  [new RegExp(String.raw`assets/scenes/([^/]+)/(?:[^/]+/)?${VER}/[^/]+${IMAGE}`, "i"), (m) => ({ kind: "location", subject: m[1], version: m[2] })],
  [new RegExp(String.raw`assets/props/([^/]+)/${VER}/[^/]+${IMAGE}`, "i"), (m) => ({ kind: "prop", subject: m[1], version: m[2] })],
  [new RegExp(String.raw`(?:^|/)bible/${VER}/bible\.(?:md|json)$`, "i"), (m) => ({ kind: "bible", version: m[1] })],
  // A screenplay version as drama-cli's screenplay validate records it, and a rewrite's review beside it
  // (short_drama drama_cli/stages.py, SCREENPLAY_FILE and REVIEW_FILE; D115, D158).
  [new RegExp(String.raw`(?:^|/)screenplay/${VER}/screenplay\.fountain$`, "i"), (m) => ({ kind: "screenplay-version", version: m[1] })],
  [new RegExp(String.raw`(?:^|/)screenplay/${VER}/review\.md$`, "i"), (m) => ({ kind: "screenplay-review", version: m[1] })],
  [/(?:^|\/)understanding\//i, () => ({ kind: "observation" })],
  // A version's spec.json and request.json beside its output (short_drama drama_cli/stages.py; doc/drama-cli/cli.md, each stage's outputs). After understanding/, whose records hold their own request.json.
  [/\/(v\d+|t\d+)\/(spec|request)\.json$/i, (m) => ({ kind: m[2].toLowerCase() as "spec" | "request", version: m[1] })],
  // A version's asset-library record, beside its picture (short_drama drama_cli/stages.py, asset.create into the version's asset/).
  [/\/(v\d+)\/asset\/asset\.json$/i, (m) => ({ kind: "asset", version: m[1] })],
];

export function classify(relPath: string): Hints {
  const normal = relPath.replaceAll("\\", "/");
  for (const [pattern, hints] of RULES) {
    const match = normal.match(pattern);
    if (match) {
      const found = hints(match);
      return { ...found, episode: found.episode && episodeCode(found.episode) };
    }
  }
  return { kind: "other" };
}

/** EP1, ep001 and EP0001 all mean EP001. */
export function episodeCode(value: string | number): string {
  const n = typeof value === "number" ? value : Number(String(value).replace(/\D/g, ""));
  return `EP${String(n).padStart(3, "0")}`;
}

/**
 * The episodes a summary lists, one per line as "EP001: title" (the setup goal asks for
 * this form), or several on a line. A code the summary only mentions in passing ("EP001
 * breakdown v1, ...") names an episode only where it isn't listed. Lines that don't match
 * are ignored.
 */
export function listedEpisodes(text: string): { number: number; title: string }[] {
  const listed = new Map<number, string>();
  const mentioned = new Map<number, string>();
  for (const line of text.split("\n").flatMap((row) => row.split(/(?<![\p{L}\p{N}])(?=EP\s*\d)/iu))) {
    const match = line.match(/\bEP\s*0*(\d{1,4})\b\s*([:：.、\-–—])?\s*(.*)$/i);
    if (match) {
      const number = Number(match[1]);
      const found = match[2] ? listed : mentioned;
      if (number > 0 && !found.has(number)) found.set(number, match[3].trim().replace(/^["“「]|["”」]$/g, ""));
    }
  }
  for (const [number, title] of mentioned) if (!listed.has(number)) listed.set(number, title);
  return [...listed.entries()].sort((a, b) => a[0] - b[0]).map(([number, title]) => ({ number, title }));
}

/**
 * The working-directory files a text names: markdown links, backquoted or bare paths with a
 * folder and an extension of up to eight letters (fountain, markdown). A question can name files
 * it didn't return (Pine lists a turn's files only when the agent returns them), so the studio
 * fetches what the question names.
 */
export function namedPaths(text: string): string[] {
  const found = new Set<string>();
  const candidates = [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:^|[\s(（「“"'：:，,])((?:[^\s()（）\[\]`'"“”「」<>，,：:;；]+\/)+[^\s()（）\[\]`'"“”「」<>，,：:;；/]+\.(?:tar\.part-[a-z0-9]+|[A-Za-z0-9]{1,8}))(?=$|[\s)）」”"'，,。.;；:：!?！？])/g)].map((m) => m[1]),
  ];
  for (const raw of candidates) {
    if (/^[a-z][\w+.-]*:\/\//i.test(raw)) continue; // a web address, not a file
    let file = raw.trim().replace(/^\.\//, "");
    // An absolute path inside the session's working directory: the part after files/.
    if (file.startsWith("/")) file = file.includes("/files/") ? file.slice(file.indexOf("/files/") + "/files/".length) : "";
    if (!file || !file.includes("/") || !/\.(?:[A-Za-z0-9]{1,8}|tar\.part-[a-z0-9]+)$/.test(file) || file.split("/").some((part) => !part || part === "." || part === "..")) continue;
    found.add(file);
  }
  return [...found];
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  txt: "text/plain",
  // Fountain is plain text (fountain.io/syntax); drama-cli writes a screenplay as screenplay.fountain.
  fountain: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  srt: "application/x-subrip",
};

/** A media type for a file the studio fetched by name, from its extension. */
export function typeOf(relPath: string): string {
  return TYPES[relPath.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}
