import { describe, expect, it } from "vitest";
import type { Item } from "./fold";
import { doing, rows, say, stepCount, trail, type StepItem } from "./steps";

let n = 0;
const step = (title: string, extra: Partial<StepItem> = {}): StepItem => ({ kind: "step", id: `s${(n += 1)}`, title, state: "completed", type: "browser", at: 1000 * n, ...extra });

describe("say", () => {
  it("says what was done, and names the site a page step ended on", () => {
    expect(say(step("Open a page", { url: "https://news.ycombinator.com/item?id=1" }))).toEqual({ text: "Opened news.ycombinator.com" });
    expect(say(step("Click “Log in”", { url: "https://www.example.com/" }))).toEqual({ text: "Clicked “Log in”", quiet: "example.com" });
    expect(say(step("Create quotes.html", { type: "file" }))).toEqual({ text: "Created quotes.html" });
  });

  it("never shows a command as the main text", () => {
    expect(say(step("Run glance=1; true", { type: "command" }))).toEqual({ text: "Ran a command", mono: "glance=1; true" });
  });

  it("says a step under way in the present, on the live stream only", () => {
    const reading = step("Read the page", { state: "running", url: "https://news.ycombinator.com/" });
    expect(say(reading, true).text).toBe("Reading news.ycombinator.com");
    expect(say(reading).text).toBe("Read news.ycombinator.com");
    expect(doing([reading])).toBe("Reading news.ycombinator.com");
  });

  it("leaves a title it doesn't know as written", () => {
    expect(say(step("Frobnicate the widget")).text).toBe("Frobnicate the widget");
  });
});

describe("rows", () => {
  it("folds a run of the same step into one row, with its sites", () => {
    const items: Item[] = [
      step("Open a page", { url: "https://a.com/" }),
      step("Open a page", { url: "https://b.org/x" }),
      step("Open a page", { url: "https://a.com/y", state: "failed" }),
      { kind: "note", id: "n1", text: "Reading on.", at: 0 },
      step("Run ls", { type: "command" }),
      step("Run pwd", { type: "command" }),
      step("Read the page", { url: "https://a.com/" }),
    ];
    const out = rows(items);
    expect(out.map((row) => (row.kind === "steps" ? row.said.text : row.kind))).toEqual(["Opened 3 pages", "note", "Ran 2 commands", "Read a.com"]);
    expect(out[0]).toMatchObject({ said: { quiet: "a.com, b.org" }, failed: 1 });
    expect(stepCount(items)).toBe("6 steps");
  });
});

describe("trail", () => {
  it("keeps one picture per screen: a read of the same page replaces it", () => {
    const shots = trail([
      step("Open a page", { url: "https://a.com/", shot: "1.webp" }),
      step("Read the page", { url: "https://a.com/", shot: "2.webp" }),
      step("Run ls", { type: "command" }),
      step("Click “Next”", { url: "https://a.com/", shot: "3.webp" }),
    ]);
    expect(shots.map((shot) => [shot.src, shot.caption])).toEqual([
      ["2.webp", "Opened a.com"],
      ["3.webp", "Clicked “Next”"],
    ]);
  });
});
