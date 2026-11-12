import { describe, expect, it } from "vitest";
import { answerText, revisedKeys } from "./decisions.ts";

const context = {
  kind: "storyboards" as const,
  subject: "EP002's storyboards",
  labels: new Map([
    ["seg01", "seg01"],
    ["seg03", "seg03"],
  ]),
  paths: new Map([[7, "drama/episodes/EP002/multi_panel_storyboard/seg03/line-art/v1/image-1.png"]]),
};

describe("answerText", () => {
  it("approves everything in one line and quotes the maker", () => {
    const text = answerText(
      { items: [{ key: "seg01", verdict: "approve", notes: [] }, { key: "seg03", verdict: "approve", notes: [] }], words: "Looks right." },
      context,
    );
    expect(text).toBe(`My review of EP002's storyboards.\nApproved: all 2.\nIn my own words: "Looks right."`);
  });

  it("names the file and the spot of each note on an item to revise", () => {
    const text = answerText(
      {
        items: [
          { key: "seg01", verdict: "approve", notes: [] },
          { key: "seg03", verdict: "revise", notes: [{ fileId: 7, x: 0.7, y: 0.62, text: "the letter is in her left hand" }] },
        ],
        words: "",
      },
      context,
    );
    expect(text).toBe(
      "My review of EP002's storyboards.\nApproved: seg01.\nRevise:\n" +
        "- seg03: the letter is in her left hand (on drama/episodes/EP002/multi_panel_storyboard/seg03/line-art/v1/image-1.png, at 70% across and 62% down)",
    );
    expect(revisedKeys(text)).toEqual(["seg03"]);
  });

  it("puts a time on notes made on a video", () => {
    const text = answerText({ items: [{ key: "cut", verdict: "revise", notes: [{ time: 47.2, text: "the slap lands early" }] }], words: "" }, { ...context, kind: "cut" });
    expect(text).toContain("- cut: the slap lands early (at 0:47)");
  });

  it("sends a plain question's answer as the maker wrote it", () => {
    expect(answerText({ items: [], words: "He is 32." }, { ...context, kind: "question" })).toBe("He is 32.");
  });
});
