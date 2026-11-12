import { describe, expect, test } from "vitest";
import type { WireEvent } from "@/shared/events";
import { film, fold, pieces, rows, tally } from "./fold";

let id = 0;
const at = (s: number) => 1_760_000_000_000 + s * 1000;
const ev = (turnId: string, s: number, body: Partial<WireEvent>): WireEvent => ({ id: ++id, turnId, at: at(s), type: "x", ...body });
const hr = { title: "Human Resources", url: "https://example.org/hr" };

describe("fold", () => {
  test("a turn is its ask, its steps by id, and its outcome", () => {
    const events = [
      ev("t1", 0, { input: { kind: "run", text: "Find the schedule" } }),
      ev("t1", 1, { step: { id: "s1", state: "running", kind: "browser", title: "Open Human Resources" } }),
      ev("t1", 3, { step: { id: "s1", state: "completed", kind: "browser", title: "Open Human Resources", facts: { page: hr } } }),
      ev("t1", 4, { frame: { src: "data:image/webp;base64,AA", stepId: "s1" } }),
      ev("t1", 5, { outcome: { reason: "completed", summary: "Done.", files: [], durationMs: 5000, cost: 0.01 } }),
    ];
    const [turn] = fold(events);
    expect(turn.ask).toEqual({ kind: "run", text: "Find the schedule", at: at(0) });
    expect(turn.items).toHaveLength(1);
    expect(turn.items[0]).toMatchObject({ kind: "step", endedAt: at(3), frames: [{ src: "data:image/webp;base64,AA" }] });
    expect(turn.outcome?.summary).toBe("Done.");
    // Replaying the same events changes nothing.
    expect(fold([...events, ...events])).toEqual(fold(events));
  });

  test("an answer opens the next turn; a steer and a hand-over stay in the turn they happened in", () => {
    const turns = fold([
      ev("t1", 0, { input: { kind: "run", text: "Book it" } }),
      ev("t1", 1, { outcome: { reason: "needs_input", summary: "Which date?", files: [], durationMs: 1, cost: null } }),
      ev("t2", 2, { input: { kind: "answer", text: "Friday" } }),
      ev("t2", 3, { input: { kind: "steer", text: "Window seat" } }),
      ev("", 4, { controller: "human" }),
      ev("", 5, { controller: "locked" }),
    ]);
    expect(turns.map((t) => t.ask?.kind)).toEqual(["run", "answer"]);
    expect(turns[1].items.map((item) => item.kind === "steer" || item.kind === "control" ? item.text : item.kind)).toEqual([
      "Window seat",
      "You took the controls",
      "Controls locked: the desktop couldn’t be confirmed",
    ]);
  });
});

describe("how a turn reads", () => {
  test("notes sit inside the work; a steer splits it; notes alone stand alone", () => {
    const [turn] = fold([
      ev("t1", 0, { progress: { text: "Starting." } }),
      ev("t1", 1, { step: { id: "c1", state: "completed", kind: "command", title: "Run ls" } }),
      ev("t1", 2, { input: { kind: "steer", text: "Also check the board" } }),
      ev("t1", 3, { progress: { text: "Checking." } }),
    ]);
    expect(pieces(turn).map((p) => p.kind)).toEqual(["work", "steer", "note"]);
  });

  test("steps that ended on one page are one visit, continued across a note, with repeats counted", () => {
    const [turn] = fold([
      ev("t1", 0, { step: { id: "b1", state: "completed", kind: "browser", title: "Open Human Resources", facts: { page: hr } } }),
      ev("t1", 1, { frame: { src: "first", stepId: "b1" } }),
      ev("t1", 2, { progress: { text: "Reading the table." } }),
      ev("t1", 3, { step: { id: "b2", state: "completed", kind: "browser", title: "Read the page", facts: { page: hr, steps: ["Read the page", "Read the page"] } } }),
      ev("t1", 4, { frame: { src: "later", stepId: "b2" } }),
      ev("t1", 5, { step: { id: "b3", state: "failed", kind: "browser", title: "Click “PDF”", facts: { page: { ...hr, title: "Salary" } } } }),
      ev("t1", 6, { step: { id: "c1", state: "completed", kind: "command", title: "Run pdftotext" } }),
    ]);
    const list = rows(turn.items);
    expect(list.map((r) => r.kind)).toEqual(["visit", "note", "visit", "visit", "step"]);
    const [first, , again, other] = list as Extract<(typeof list)[number], { kind: "visit" }>[];
    expect([first.continued, again.continued]).toEqual([false, true]);
    expect(again.actions).toEqual([{ text: "Read the page", state: "completed", times: 2 }]);
    // Another title at the same address is another page.
    expect(other).toMatchObject({ title: "Salary", state: "failed" });
    expect(tally(list)).toBe("2 pages · 1 command");
    // One screen per page: the continued visit's later one replaces the first.
    expect(film(list).map((f) => f.frame.src)).toEqual(["later"]);
  });
});
