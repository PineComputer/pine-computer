// Browsing shows what each review decided on, and nothing more: a takes review says nothing
// about storyboards the same turn returned, and approving several cuts at once approves none
// of them in particular.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATA = mkdtempSync(path.join(tmpdir(), "studio-browse-"));
process.env.STUDIO_DATA_DIR = DATA;
process.env.STUDIO_SECRET = Buffer.alloc(32, 1).toString("base64");

let browse: typeof import("./browse.ts");

beforeAll(async () => {
  const { db, run } = await import("./db.ts");
  browse = await import("./browse.ts");
  db();
  const at = new Date().toISOString();
  run(
    "insert into dramas (id, title, language, look, format, parallel, per_computer, notes, mode, status, created_at, updated_at) values ('d1', 'Test', 'en', 'live action', '9:16, 480p', 1, 1, '', 'replay', 'production', ?, ?)",
    at,
    at,
  );
  run("insert into episodes (id, drama_id, number, title, state, updated_at) values ('e1', 'd1', 1, 'One', 'waiting', ?)", at);
  const file = (id: number, turn: string, relPath: string, kind: string, segment: string | null, version: string, type: string) =>
    run(
      "insert into files (id, drama_id, episode_id, session_id, turn_id, sha, rel_path, name, type, size, kind, segment, version, created_at) values (?, 'd1', 'e1', 's1', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
      id,
      turn,
      `sha${id}`.padEnd(64, "0"),
      relPath,
      path.basename(relPath),
      type,
      kind,
      segment,
      version,
      at,
    );
  // One turn returned seg01's storyboard and its take; the maker reviewed the takes.
  file(1, "t1", "episodes/EP001/multi_panel_storyboard/seg01/line-art/v1/image-1.png", "storyboard", "seg01", "v1", "image/png");
  file(2, "t1", "episodes/EP001/segments/seg01/t01/video.mp4", "take", "seg01", "t01", "video/mp4");
  // Another returned two cuts at once, and the maker approved "the cut".
  file(3, "t2", "episodes/EP001/edit/v1/cut.mp4", "cut", null, "v1", "video/mp4");
  file(4, "t2", "episodes/EP001/edit/v2/cut.mp4", "cut", null, "v2", "video/mp4");
  const review = (id: string, turn: string, kind: string, key: string) =>
    run(
      "insert into reviews (id, drama_id, episode_id, session_id, turn_id, kind, state, question, decision, answer, created_at) values (?, 'd1', 'e1', 's1', ?, ?, 'answered', '', ?, '', ?)",
      id,
      turn,
      kind,
      JSON.stringify({ words: "", items: [{ key, verdict: "approve", notes: [] }] }),
      at,
    );
  review("r1", "t1", "takes", "seg01");
  review("r2", "t2", "cut", "cut");
  // The setup checked the original (v1), then returned a rewrite (v2) and asks the maker to accept it.
  file(5, "t3", "drama/screenplay/v1/screenplay.fountain", "other", null, "", "text/plain");
  file(6, "t4", "drama/screenplay/v2/screenplay.fountain", "screenplay-version", null, "v2", "text/plain");
  file(7, "t4", "drama/screenplay/v2/review.md", "screenplay-review", null, "v2", "text/markdown");
  // The maker gave two files; the second is the one marked as the screenplay.
  file(8, "", "notes.txt", "screenplay", null, "", "text/plain");
  file(9, "", "story.txt", "screenplay", null, "", "text/plain");
  run("insert into inputs (drama_id, file_id) values ('d1', 8), ('d1', 9)");
  run("update dramas set screenplay_file = 9 where id = 'd1'");
  // seg02: one turn returned its two storyboards with its blocking reference and the plate crop the blocking was drawn
  // from (saved as blocking before the crops were told apart); a later turn returned the blocking reference again.
  file(10, "t5", "drama/episodes/EP001/multi_panel_storyboard/seg02/line-art/v1/image-1.jpg", "storyboard", "seg02", "v1", "image/jpeg");
  file(11, "t5", "drama/episodes/EP001/multi_panel_storyboard/seg02/photoreal/v1/image-1.jpg", "storyboard", "seg02", "v1", "image/jpeg");
  run("update files set style = 'line-art' where id = 10");
  run("update files set style = 'photoreal' where id = 11");
  file(12, "t5", "drama/episodes/EP001/blocking/seg02/v1/image-1.jpg", "blocking", "seg02", "v1", "image/jpeg");
  file(13, "t6", "drama/episodes/EP001/blocking/seg02/v2/image-1.jpg", "blocking", "seg02", "v2", "image/jpeg");
  file(14, "t6", "drama/episodes/EP001/blocking/seg02/v2/view.png", "blocking", "seg02", "v2", "image/png");
  run(
    "insert into reviews (id, drama_id, episode_id, session_id, turn_id, kind, state, question, decision, answer, created_at) values ('r3', 'd1', null, 's1', 't4', 'question', 'open', 'Accept the rewrite?', null, '', ?)",
    at,
  );
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe("browsing", () => {
  it("puts a verdict only on what its review judged", () => {
    const page = browse.episodePage("d1", "EP001")!;
    expect(page.segments[0].takes[0].review?.verdict).toBe("approve");
    expect(page.segments[0].boards[0].review).toBeUndefined();
  });

  it("keeps a segment's storyboards apart from its blocking reference, and its input crops out of both", () => {
    const page = browse.episodePage("d1", "EP001")!;
    const seg02 = page.segments.find((segment) => segment.key === "seg02")!;
    expect(seg02.boards.map((receipt) => receipt.files.map((file) => file.id))).toEqual([[10, 11]]);
    expect(seg02.stills.map((receipt) => receipt.files.map((file) => file.id))).toEqual([[13], [12]]);
    expect(page.other.map((file) => file.id)).toContain(14);
    // Each tab's version list holds one kind: the storyboard round never offers a blocking version, nor the reverse.
    expect(seg02.boards.flatMap((receipt) => receipt.files.map((file) => file.kind))).toEqual(["storyboard", "storyboard"]);
    expect(new Set(seg02.stills.flatMap((receipt) => receipt.files.map((file) => file.kind)))).toEqual(new Set(["blocking"]));
  });

  it("approves no single cut when the review showed several", () => {
    const [row] = browse.deliveryRows("d1");
    expect(row.accepted).toBeUndefined();
    expect(row.ambiguous).toBe(true);
    expect(row.latest?.together).toBe(2);
  });

  it("shows the newest screenplay version and its review, waiting while its question is open", () => {
    const current = browse.scriptPage("d1").screenplay!;
    expect([current.version, current.file?.id, current.review?.id, current.pending]).toEqual(["v2", 6, 7, true]);
  });

  it("names the screenplay the maker marked, for the rewrite to be set beside it", () => {
    expect(browse.scriptPage("d1").screenplayFile).toBe(9);
  });
});
