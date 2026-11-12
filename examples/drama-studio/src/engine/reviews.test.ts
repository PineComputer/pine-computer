// What a review shows the maker of a stop's files: the status of the project each stop
// returns is for the studio, not something to review.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FileKind } from "../shared/types.ts";
import type { FileRow } from "./library.ts";

process.env.STUDIO_DATA_DIR = mkdtempSync(path.join(tmpdir(), "studio-reviews-"));
process.env.STUDIO_SECRET = Buffer.alloc(32, 1).toString("base64");

let reviews: typeof import("./reviews.ts");

beforeAll(async () => {
  reviews = await import("./reviews.ts");
});

let nextId = 1;
function row(relPath: string, kind: FileKind, fields: Partial<FileRow> = {}): FileRow {
  return {
    id: nextId++, drama_id: "d1", episode_id: "e2", session_id: "s1", turn_id: "t1", sha: `sha${nextId}`, rel_path: relPath,
    name: path.posix.basename(relPath), type: "application/json", size: 1, kind, subject: null, look: null, segment: null,
    style: null, version: null, created_at: "2026-10-29T10:00:00Z", ...fields,
  };
}

describe("a stop's files in its review", () => {
  it("leave out the status of the project, as they leave out the packed project", () => {
    const board = row("drama/episodes/EP002/multi_panel_storyboard/seg01/line-art/v1/image-1.png", "storyboard", { type: "image/png", segment: "seg01", style: "line-art", version: "v1" });
    const { items, other } = reviews.itemsOf("storyboards", [board, row("handoff/status.json", "status"), row("handoff/EP002.tar.part-aa", "archive")]);
    expect(items.map((item) => item.key)).toEqual(["seg01"]);
    expect(other).toEqual([]);
  });

  it("leave out the refusals the stop asks about", () => {
    const take = row("drama/episodes/EP002/segments/seg01/t02/video.mp4", "take", { type: "video/mp4", segment: "seg01", version: "t02" });
    const { items, other } = reviews.itemsOf("takes", [take, row("handoff/refusals.jsonl", "refusal")]);
    expect(items.map((item) => item.key)).toEqual(["seg01"]);
    expect(other).toEqual([]);
  });

  it("leave out drama-cli's statement of each job and its request", () => {
    const look = row("drama/assets/characters/lin/v1/image-1.png", "look", { type: "image/png", subject: "lin", version: "v1" });
    const { items, other } = reviews.itemsOf("looks", [look, row("drama/assets/characters/lin/v1/spec.json", "spec"), row("drama/assets/characters/lin/v1/request.json", "request")]);
    expect(items).toHaveLength(1);
    expect(items[0].files).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it("leave out the project as infinite-canvas reads it", () => {
    const look = row("drama/assets/characters/lin/v1/image-1.png", "look", { type: "image/png", subject: "lin", version: "v1" });
    const { items, other } = reviews.itemsOf("looks", [look, row("handoff/infinite-canvas.zip", "infinite-canvas")]);
    expect(items).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it("leave out drama-cli's record of a picture's asset registration", () => {
    const look = row("drama/assets/characters/lin/v1/image-1.png", "look", { type: "image/png", subject: "lin", version: "v1" });
    const { items, other } = reviews.itemsOf("looks", [look, row("drama/assets/characters/lin/v1/asset/asset.json", "asset")]);
    expect(items[0].files).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it("leave out the lineage of the project", () => {
    const look = row("drama/assets/characters/lin/v1/image-1.png", "look", { type: "image/png", subject: "lin", version: "v1" });
    const { items, other } = reviews.itemsOf("looks", [look, row("handoff/lineage.json", "lineage")]);
    expect(items).toHaveLength(1);
    expect(other).toEqual([]);
  });
});
