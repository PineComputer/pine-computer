// What the goals ask the agent to hand back at each stop besides the files under review:
// drama-cli's own status of the project, which the skill calls the source of truth.
import { describe, expect, it } from "vitest";
import { editGoal, episodeGoal, rehearsed, resumeGoal, setupGoal, type DramaBrief } from "./goals.ts";

const drama: DramaBrief = {
  title: "The Stepmother",
  language: "en",
  look: "",
  format: "9:16, 480p",
  notes: "",
  length: "60",
  preset: "en-us-live-sfw",
  screenplay_language: "en",
};

const STATUS = "drama-cli status --config drama/drama-cli.cfg.yaml > handoff/status.json";

function times(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("each stop returns drama-cli's status", () => {
  it("in the setup session", () => {
    const goal = setupGoal(drama, ["screenplay.md", "brief.md"], { screenplay: "screenplay.md", brief: "brief.md" });
    expect(times(goal, STATUS)).toBe(1);
    expect(goal).toContain("return handoff/status.json");
  });

  it("in an episode's session", () => {
    const goal = episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md");
    expect(times(goal, STATUS)).toBe(1);
    expect(goal).toContain("return handoff/status.json");
  });

  it("in a session that carries an episode on", () => {
    const goal = resumeGoal(drama, "EP002", ["project.tar.part-aa", "EP002.tar.part-aa"], true, undefined, "screenplay.md");
    expect(times(goal, STATUS)).toBe(1);
  });

  it("with the config the session's own init writes, the one every other command in the goal names", () => {
    const goal = episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md");
    expect(goal).toContain("drama-cli status --config drama/drama-cli.cfg.yaml`.");
    expect(goal).toContain("drama-cli init drama ");
  });

  it("but not in a rehearsal, which has no drama-cli to ask", () => {
    const goal = rehearsed(episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md"));
    expect(goal).toContain("return no handoff/status.json");
  });
});

const REFUSALS = "exactly the JSON line the command printed (`{\"error\": ...}`), one per line, in handoff/refusals.jsonl";

describe("a stop that asks about a drama-cli refusal returns the refusal", () => {
  it.each([
    ["the setup session", setupGoal(drama, ["screenplay.md", "brief.md"], { screenplay: "screenplay.md", brief: "brief.md" })],
    ["an episode's session", episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md")],
    ["a session that carries an episode on", resumeGoal(drama, "EP002", ["project.tar.part-aa", "EP002.tar.part-aa"], true, undefined, "screenplay.md")],
  ])("in %s, as drama-cli printed it, afresh at each such stop and at no other", (_where, goal) => {
    expect(times(goal, REFUSALS)).toBe(1);
    expect(goal).toContain("written afresh at each such stop");
    expect(goal).toContain("at any other stop, return none");
  });

  it("but not in a rehearsal, which has no drama-cli to refuse", () => {
    const goal = rehearsed(episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md"));
    expect(goal).toContain("return no handoff/status.json, handoff/lineage.json, handoff/infinite-canvas.zip or handoff/refusals.jsonl");
  });
});

const LINEAGE = "drama-cli export comfyui --config drama/drama-cli.cfg.yaml --out handoff/lineage.json";

describe("each stop returns drama-cli's lineage", () => {
  it.each([
    ["the setup session", setupGoal(drama, ["screenplay.md", "brief.md"], { screenplay: "screenplay.md", brief: "brief.md" })],
    ["an episode's session", episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md")],
    ["a session that carries an episode on", resumeGoal(drama, "EP002", ["project.tar.part-aa", "EP002.tar.part-aa"], true, undefined, "screenplay.md")],
  ])("in %s, written outside the project, as drama-cli's export requires", (_where, goal) => {
    expect(times(goal, LINEAGE)).toBe(1);
    expect(goal).toContain("return handoff/lineage.json");
  });

  it("but not in a rehearsal, which has no drama-cli to ask", () => {
    const goal = rehearsed(episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md"));
    expect(goal).toContain("return no handoff/status.json, handoff/lineage.json, handoff/infinite-canvas.zip or handoff/refusals.jsonl");
  });
});

const SPECS = "also return the spec.json and request.json in that version's folder, and asset/asset.json where drama-cli registered the picture in the asset library";

describe("each picture, take or cut comes with drama-cli's statement of the job", () => {
  it.each([
    ["the setup session", setupGoal(drama, ["screenplay.md", "brief.md"], { screenplay: "screenplay.md", brief: "brief.md" })],
    ["an episode's session", episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md")],
    ["a session that carries an episode on", resumeGoal(drama, "EP002", ["project.tar.part-aa", "EP002.tar.part-aa"], true, undefined, "screenplay.md")],
  ])("in %s, asked for by name, never worked out from the folder", (_where, goal) => {
    expect(times(goal, SPECS)).toBe(1);
  });

  it("but not in a rehearsal, whose stand-in writes none", () => {
    const goal = rehearsed(episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md"));
    expect(goal).toContain("and no spec.json, request.json or asset/asset.json");
  });
});

const CANVAS = "drama-cli export infinite-canvas --config drama/drama-cli.cfg.yaml --out handoff/infinite-canvas.zip";

describe("each stop returns the project as infinite-canvas's import reads it", () => {
  it.each([
    ["the setup session", setupGoal(drama, ["screenplay.md", "brief.md"], { screenplay: "screenplay.md", brief: "brief.md" })],
    ["an episode's session", episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md")],
    ["a session that carries an episode on", resumeGoal(drama, "EP002", ["project.tar.part-aa", "EP002.tar.part-aa"], true, undefined, "screenplay.md")],
  ])("in %s, beside the lineage, outside the project", (_where, goal) => {
    expect(times(goal, CANVAS)).toBe(1);
    expect(goal).toContain("return handoff/lineage.json and handoff/infinite-canvas.zip");
  });

  it("but not in a rehearsal, which has no drama-cli to ask", () => {
    const goal = rehearsed(episodeGoal(drama, "EP002", ["project.tar.part-aa"], true, "screenplay.md"));
    expect(goal).toContain("handoff/infinite-canvas.zip");
    expect(goal).toContain("return no handoff/status.json, handoff/lineage.json, handoff/infinite-canvas.zip or handoff/refusals.jsonl");
  });
});

describe("the maker's edit of a cut", () => {
  const goal = editGoal("EP006", "drama/episodes/EP006/edit/v1/cut.mp4", [
    { path: "drama/episodes/EP006/segments/seg03/t02/video.mp4", in: 1.2, out: 10, audio: "source" },
    { path: "drama/episodes/EP006/segments/seg01/t02/video.mp4", in: 0, out: 5, audio: "silence" },
  ]);

  it("lists the clips in the maker's order, with their ranges and sound", () => {
    expect(goal).toContain("1. drama/episodes/EP006/segments/seg03/t02/video.mp4, from 1.2 s to 10 s, with its own sound");
    expect(goal).toContain("2. drama/episodes/EP006/segments/seg01/t02/video.mp4, from 0 s to 5 s, silent");
  });

  it("builds with drama-cli edit and validates, stopping on drama-cli's refusal", () => {
    expect(goal).toContain("`drama-cli edit build EP006 <the plan> --config drama/drama-cli.cfg.yaml`");
    expect(goal).toContain("`drama-cli edit validate EP006 --config drama/drama-cli.cfg.yaml`");
    expect(goal).toContain("If drama-cli refuses my edit, stop and tell me");
  });
});
