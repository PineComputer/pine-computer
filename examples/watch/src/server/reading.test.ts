import { describe, expect, it } from "vitest";
import { compare, goalFor, parseReading, sentence } from "./reading";

describe("parseReading", () => {
  it("reads the json block that ends the answer", () => {
    const answer = 'The top story is below.\n```json\n{"fields": [{"label": "Top story", "value": " FAA issues  ground stop "}], "place": "top left"}\n```';
    expect(parseReading(answer)).toEqual({ fields: [{ label: "Top story", value: "FAA issues ground stop" }], place: "top left" });
  });

  it("reads a bare object, and drops a place it doesn't know", () => {
    expect(parseReading('{"fields":[{"label":"Price","value":"$20"}],"place":"somewhere"}')).toEqual({ fields: [{ label: "Price", value: "$20" }] });
  });

  it("answers null when there is no reading", () => {
    expect(parseReading("The page needs a sign-in.")).toBeNull();
    expect(parseReading('```json\n{"fields": []}\n```')).toBeNull();
  });
});

describe("compare", () => {
  const before = [{ label: "Top story", value: "A" }, { label: "Site", value: "a.com" }];

  it("finds nothing when the values match, however the names are spelled", () => {
    expect(compare(before, [{ label: "top_story", value: "A" }, { label: "site", value: "a.com" }])).toEqual([]);
  });

  it("names what changed, what is new and what is gone", () => {
    expect(compare(before, [{ label: "Top story", value: "B" }, { label: "Points", value: "9" }])).toEqual([
      { label: "Top story", before: "A", after: "B" },
      { label: "Points", before: "", after: "9" },
      { label: "Site", before: "a.com", after: "" },
    ]);
  });
});

describe("sentence", () => {
  it("says one change with both values", () => {
    expect(sentence([{ label: "top story", before: "A", after: "B" }])).toBe("Top story changed from “A” to “B”.");
  });

  it("names several", () => {
    expect(sentence([{ label: "Top story", before: "A", after: "B" }, { label: "Site", before: "a.com", after: "b.com" }])).toBe("Top story and site changed.");
  });
});

describe("goalFor", () => {
  it("asks for the same names again", () => {
    const goal = goalFor({ what: "the top story", url: "https://news.ycombinator.com" }, ["Top story"]);
    expect(goal).toContain("- Top story");
    expect(goal).toContain("https://news.ycombinator.com");
  });
});
