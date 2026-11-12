import { describe, expect, it } from "vitest";
import { shotListOf } from "./shots.ts";

const breakdown = `# EP001 — breakdown

## seg01
- Shot 1: Lin enters the yard
- Shot 2: Wei: You're late.

## seg010
- Shot 1: Ten

## seg02 · dinner
* Shot 1: The family at dinner`;

describe("shotListOf", () => {
  it("reads the lines under the segment's own heading", () => {
    expect(shotListOf(breakdown, "seg01")).toEqual(["Shot 1: Lin enters the yard", "Shot 2: Wei: You're late."]);
    expect(shotListOf(breakdown, "seg02")).toEqual(["Shot 1: The family at dinner"]);
  });

  it("names a segment exactly, not by prefix", () => {
    expect(shotListOf(breakdown, "seg010")).toEqual(["Shot 1: Ten"]);
    expect(shotListOf(breakdown, "seg0")).toBeUndefined();
  });

  it("finds nothing in text laid out another way", () => {
    expect(shotListOf("seg01: Lin enters", "seg01")).toBeUndefined();
    expect(shotListOf(undefined, "seg01")).toBeUndefined();
  });
});
