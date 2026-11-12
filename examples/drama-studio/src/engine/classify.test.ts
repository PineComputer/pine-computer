import { describe, expect, it } from "vitest";
import { classify, episodeCode, listedEpisodes, namedPaths, typeOf } from "./classify.ts";

describe("classify", () => {
  it("reads a storyboard's episode, segment, style and version", () => {
    expect(classify("outputs/projects/show/episodes/EP002/multi_panel_storyboard/seg03/line-art/v4/image-1.jpg")).toEqual({
      kind: "storyboard",
      episode: "EP002",
      segment: "seg03",
      style: "line-art",
      version: "v4",
    });
  });

  it("reads the packed projects sessions hand over", () => {
    expect(classify("handoff/project.tar.part-aa")).toEqual({ kind: "archive" });
    expect(classify("work/handoff/EP007.tar.part-ab")).toEqual({ kind: "archive", episode: "EP007" });
  });

  it("reads the status of the project each stop returns", () => {
    expect(classify("handoff/status.json")).toEqual({ kind: "status" });
    expect(classify("work/handoff/status.json")).toEqual({ kind: "status" });
    expect(classify("drama/status.json").kind).not.toBe("status");
  });

  it("reads the project as infinite-canvas's import reads it, which each stop returns", () => {
    expect(classify("handoff/infinite-canvas.zip")).toEqual({ kind: "infinite-canvas" });
    expect(classify("drama/infinite-canvas.zip").kind).not.toBe("infinite-canvas");
  });

  it("reads the lineage of the project each stop returns", () => {
    expect(classify("handoff/lineage.json")).toEqual({ kind: "lineage" });
    expect(classify("work/handoff/lineage.json")).toEqual({ kind: "lineage" });
    expect(classify("drama/lineage.json").kind).not.toBe("lineage");
  });

  it("knows drama-cli's statement of a version's job, and what went to the provider", () => {
    expect(classify("drama/assets/characters/lin/v1/spec.json")).toEqual({ kind: "spec", version: "v1" });
    expect(classify("drama/episodes/EP001/segments/seg01/t02/spec.json")).toEqual({ kind: "spec", version: "t02" });
    expect(classify("drama/episodes/EP001/multi_panel_storyboard/seg01/line-art/v3/request.json")).toEqual({ kind: "request", version: "v3" });
    expect(classify("drama/understanding/abc/request.json").kind).toBe("observation");
    expect(classify("drama/spec.json").kind).not.toBe("spec");
  });

  it("knows drama-cli's record of a picture registered in the asset library, by the version it registered", () => {
    expect(classify("drama/assets/characters/lin/states/S1/v1/asset/asset.json")).toEqual({ kind: "asset", version: "v1" });
    expect(classify("drama/episodes/EP001/multi_panel_storyboard/seg01/line-art/v3/asset/asset.json")).toEqual({ kind: "asset", version: "v3" });
    expect(classify("drama/understanding/abc/asset/asset.json").kind).toBe("observation");
    expect(classify("drama/asset/asset.json").kind).not.toBe("asset");
  });

  it("reads the refusals a stop asks about", () => {
    expect(classify("handoff/refusals.jsonl")).toEqual({ kind: "refusal" });
    expect(classify("work/handoff/refusals.jsonl")).toEqual({ kind: "refusal" });
    expect(classify("drama/refusals.jsonl").kind).not.toBe("refusal");
  });

  it("reads takes and cuts", () => {
    expect(classify("episodes/EP010/segments/seg01b/t02/video.mp4")).toMatchObject({ kind: "take", episode: "EP010", segment: "seg01b", version: "t02" });
    expect(classify("episodes/EP010/edit/v3/cut.mp4")).toMatchObject({ kind: "cut", episode: "EP010", version: "v3" });
  });

  it("reads character looks, base and named", () => {
    expect(classify("assets/characters/lin/v2/image-1.png")).toMatchObject({ kind: "look", subject: "lin", look: "base", version: "v2" });
    expect(classify("assets/characters/lin/states/S1/v1/image-1.png")).toMatchObject({ kind: "look", subject: "lin", look: "S1" });
  });

  it("reads locations with a view folder, props, the bible and breakdowns", () => {
    expect(classify("assets/scenes/office/front/v1/image-1.png")).toMatchObject({ kind: "location", subject: "office" });
    expect(classify("assets/props/letter/v1/image-1.webp")).toMatchObject({ kind: "prop", subject: "letter" });
    expect(classify("bible/v3/bible.md")).toMatchObject({ kind: "bible", version: "v3" });
    expect(classify("episodes/EP001/breakdown/v2/breakdown.md")).toMatchObject({ kind: "breakdown", episode: "EP001" });
  });

  it("reads the screenplay versions drama-cli records and a rewrite's review, but not the agent's working copy", () => {
    expect(classify("drama/screenplay/v2/screenplay.fountain")).toMatchObject({ kind: "screenplay-version", version: "v2" });
    expect(classify("drama/screenplay/v2/review.md")).toMatchObject({ kind: "screenplay-review", version: "v2" });
    expect(classify("drama/screenplay/v2/validate.json").kind).toBe("other");
    expect(classify("drama/inputs/screenplay.fountain.txt").kind).toBe("other");
  });

  it("reads what the skill added: a place at night, first frames, subtitles, and the script beside a breakdown", () => {
    expect(classify("drama/assets/scenes/office/times/Night/v2/image-1.png")).toMatchObject({ kind: "location", subject: "office", look: "Night", version: "v2" });
    expect(classify("drama/assets/scenes/office/v1/image-1.png")).not.toHaveProperty("look");
    expect(classify("drama/episodes/EP004/first_frame_reference/seg02/v1/image-1.jpg")).toMatchObject({ kind: "frame", episode: "EP004", segment: "seg02", version: "v1" });
    expect(classify("drama/episodes/EP004/asr_align/v1/cut.srt")).toMatchObject({ kind: "subtitles", episode: "EP004", version: "v1" });
    expect(classify("drama/episodes/EP004/breakdown/v1/script.md")).toEqual({ kind: "other" });
    expect(classify("drama/episodes/EP004/breakdown/v1/breakdown.json")).toMatchObject({ kind: "breakdown" });
  });

  it("takes the leads' faces as part of their looks, and further looks as shared references", async () => {
    const { inferKind } = await import("./reviews.ts");
    const face = classify("drama/assets/characters/nora/states/face/v1/image-1.jpg");
    expect(face).toMatchObject({ kind: "look", subject: "nora", look: "face" });
    const base = classify("drama/assets/characters/nora/v1/image-1.jpg");
    expect(inferKind("setup", [base, face])).toBe("looks");
    expect(inferKind("setup", [base, face, classify("drama/assets/characters/nora/states/S2/v1/image-1.jpg")])).toBe("references");
    expect(inferKind("setup", [base, classify("drama/assets/scenes/pier/times/Night/v1/image-1.png")])).toBe("references");
    // An episode made a look setup couldn't: the maker gives it a verdict, as in setup.
    const stage = classify("drama/assets/characters/lena/states/S1/v4/image-1.jpg");
    expect(inferKind("episode", [stage, classify("handoff/EP003.tar.part-aa")])).toBe("references");
    expect(inferKind("episode", [stage, classify("drama/episodes/EP003/multi_panel_storyboard/seg01/line-art/v1/image-1.jpg")])).toBe("storyboards");
  });

  it("takes a segment picture's output, never the crops drama-cli made as its inputs", () => {
    expect(classify("drama/episodes/EP001/blocking/seg01/v1/image-1.jpg")).toMatchObject({ kind: "blocking", segment: "seg01", version: "v1" });
    expect(classify("drama/episodes/EP001/blocking/seg01/v1/view.png")).toEqual({ kind: "other" });
    expect(classify("drama/episodes/EP001/multi_panel_storyboard/seg01/line-art/v2/crop.png")).toEqual({ kind: "other" });
    expect(classify("drama/episodes/EP001/multi_panel_storyboard/seg01/line-art/v2/edited-panel.png")).toEqual({ kind: "other" });
    expect(classify("drama/episodes/EP001/first_frame_reference/seg01/v1/view.png")).toEqual({ kind: "other" });
  });

  it("calls anything else other", () => {
    expect(classify("notes/today.txt")).toEqual({ kind: "other" });
    expect(classify("episodes/EP001/segments/seg01/t01/job.json")).toEqual({ kind: "other" });
  });
});

describe("episodes", () => {
  it("normalizes codes", () => {
    expect(episodeCode("EP1")).toBe("EP001");
    expect(episodeCode(12)).toBe("EP012");
  });

  it("lists the episodes a summary names, in order, once each", () => {
    const summary = "Done.\nEP002: The letter\nEP001：初见\n- EP3 — Wedding\nEP001: again\nnothing here";
    expect(listedEpisodes(summary)).toEqual([
      { number: 1, title: "初见" },
      { number: 2, title: "The letter" },
      { number: 3, title: "Wedding" },
    ]);
  });

  it("takes the listed title over a passing mention, as the drama skill's agent wrote one", () => {
    const summary = [
      "The Last Ferry project is complete and packed.",
      "- Accepted: bible v2, EP001 breakdown v1, Nora and Elias lead looks, harbor-pier base/Night plates, and ferry-ticket prop.",
      "[Download the handoff part](handoff/project.tar.part-aa)",
      "EP001: One More Minute",
    ].join("\n");
    expect(listedEpisodes(summary)).toEqual([{ number: 1, title: "One More Minute" }]);
    expect(listedEpisodes("Packed EP002 for you.")).toEqual([{ number: 2, title: "for you." }]);
  });
});

describe("namedPaths", () => {
  it("finds the files a question names but didn't return, as Pine's agent wrote one", () => {
    const question = [
      "请审批主角林晚的 v1 look。当前文件如下：",
      "- [剧集 Bible](drama/bible/v1/bible.md)",
      "- [林晚 v1 look sheet](drama/assets/characters/林晚/v1/image-1.png)",
      "See `drama/episodes/EP001/edit/v1/cut.mp4`, handoff/EP001.tar.part-aa and /var/lib/sandbox/sessions/x/files/drama/assets/props/letter/v2/image-1.png.",
      "Not https://example.com/a.png, nor 1.5, e.g. or a/b, nor ../secret/key.pem.",
    ].join("\n");
    expect(namedPaths(question)).toEqual([
      "drama/bible/v1/bible.md",
      "drama/assets/characters/林晚/v1/image-1.png",
      "drama/episodes/EP001/edit/v1/cut.mp4",
      "handoff/EP001.tar.part-aa",
      "drama/assets/props/letter/v2/image-1.png",
    ]);
  });

  it("finds a rewritten screenplay and the file it came from, as the agent named them (28 October 2026)", () => {
    // From the person's test: the .fountain link was missed while extensions stopped at five letters.
    const question = "请查看：[screenplay.fountain](drama/inputs/screenplay.fountain)；原始文件副本：[screenplay-source.docx](drama/inputs/screenplay-source.docx)。";
    expect(namedPaths(question)).toEqual(["drama/inputs/screenplay.fountain", "drama/inputs/screenplay-source.docx"]);
    expect(namedPaths("see `drama/screenplay/v1/review.markdown`")).toEqual(["drama/screenplay/v1/review.markdown"]);
  });
});

describe("typeOf", () => {
  it("gives a screenplay, a Word file and a PDF their types, so the studio can show them", () => {
    expect(typeOf("drama/inputs/screenplay.fountain")).toBe("text/plain");
    expect(typeOf("a/b.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(typeOf("a/b.pdf")).toBe("application/pdf");
    expect(typeOf("a/b.unknown")).toBe("application/octet-stream");
  });
});

describe("what the agent wrote", () => {
  it("reads episodes listed on one line, and line breaks the agent wrote out as \\n", async () => {
    const { said } = await import("./pine-fleet.ts");
    expect(listedEpisodes("EP001: 回乡 EP002: 量体\nEP3 - Dinner").map((item) => [item.number, item.title])).toEqual([
      [1, "回乡"],
      [2, "量体"],
      [3, "Dinner"],
    ]);
    const summary = said("归档：[project.tar.part-aa](handoff/project.tar.part-aa)\\n\\nEP001: 回乡\\nEP002: 量体");
    expect(listedEpisodes(summary)).toHaveLength(2);
    expect(said("keep C:\\\\new as written")).toBe("keep C:\\\\new as written");
  });
});
