import { describe, expect, it } from "vitest";
import { question } from "./api";
import type { WireEvent } from "./events";
import { fold, latest, stepCount } from "./fold";

const event = (id: number, extra: Partial<WireEvent>): WireEvent => ({ id, turnId: "t1", at: 1000 * id, type: "x", ...extra });
const step = (id: string, state: string, title = "Open a page") => ({ step: { id, state, kind: "browser", title } });

describe("fold", () => {
  it("keeps one row per step, updated when the step ends", () => {
    const work = fold([
      event(1, { input: { kind: "run", text: "Find it" } }),
      event(2, { progress: { text: "Looking." } }),
      event(3, step("s1", "running")),
      event(4, step("s1", "completed")),
      event(5, step("s2", "running", "Read the page")),
    ]).get("t1")!;
    expect(work.items.map((item) => item.kind)).toEqual(["note", "step", "step"]);
    expect(work.items[1]).toMatchObject({ id: "s1", state: "completed", at: 3000 });
    expect(stepCount(work.items)).toBe("2 steps");
    expect(latest(work.items)).toBe("Read the page");
  });

  it("ignores an event it has already folded", () => {
    const events = [event(1, { progress: { text: "Once." } })];
    expect(fold([...events, ...events]).get("t1")!.items).toHaveLength(1);
  });

  it("keeps each turn's work apart, with a steer inside the turn it steered", () => {
    const turns = fold([
      event(1, step("s1", "completed")),
      event(2, { input: { kind: "steer", text: "Only the first page" } }),
      event(3, { outcome: { reason: "needs_input", summary: "Which one?", files: [], durationMs: 3000, cost: null } }),
      event(4, { turnId: "t2", input: { kind: "answer", text: "The first" } }),
      event(5, { turnId: "t2", ...step("s2", "running") }),
    ]);
    expect(turns.get("t1")!.items.map((item) => item.kind)).toEqual(["step", "steer"]);
    expect(turns.get("t1")!.outcome).toMatchObject({ reason: "needs_input", at: 3000 });
    expect(turns.get("t2")!.items).toHaveLength(1);
    expect(turns.get("t2")!.startedAt).toBe(4000);
  });
});

describe("question", () => {
  it("reads the approval mark and leaves it out of what is shown", () => {
    expect(question("Approval needed:\nI am about to submit the order.")).toEqual({ approval: true, text: "I am about to submit the order." });
    expect(question("  approval needed: send it?")).toEqual({ approval: true, text: "send it?" });
  });

  it("leaves any other question as it is", () => {
    expect(question("Which account should I use?")).toEqual({ approval: false, text: "Which account should I use?" });
  });
});
