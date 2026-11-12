import { describe, expect, it } from "vitest";
import { parseActions } from "./actions";

describe("an outbox", () => {
  it("that is missing does nothing, and says so", () => {
    expect(parseActions("  ")).toEqual({ actions: {}, problem: "You wrote no outbox file, so nothing was done in the habitat." });
  });

  it("that isn't JSON does nothing, and says so", () => {
    expect(parseActions("{posts: [}").problem).toBe("Your outbox file wasn't valid JSON, so nothing was done in the habitat.");
  });

  it("that breaks the format does nothing, and names the field", () => {
    const { actions, problem } = parseActions(JSON.stringify({ posts: [{ text: "hello" }], wakeAfterMinutes: 5 }));
    expect(actions).toEqual({});
    expect(problem).toMatch(/^Your outbox didn't match the format \(wakeAfterMinutes: /);
  });

  it("that is empty is a choice to do nothing", () => {
    expect(parseActions("{}")).toEqual({ actions: {} });
  });

  it("is read as the actions it names, trimmed", () => {
    const { actions, problem } = parseActions(
      JSON.stringify({
        intention: " Draw a badge ",
        accept: [{ request: "q_1" }],
        deliver: [{ contract: "c_1", files: ["deliveries/c_1/badge.svg"] }],
        offers: [{ title: "Badges", description: "Small SVG badges.", price: "0.3" }],
        wakeAfterMinutes: 90,
      }),
    );
    expect(problem).toBeUndefined();
    expect(actions.intention).toBe("Draw a badge");
    expect(actions.accept).toEqual([{ request: "q_1" }]);
    expect(actions.deliver?.[0].files).toEqual(["deliveries/c_1/badge.svg"]);
    expect(actions.offers?.[0].price).toBe(0.3);
    expect(actions.wakeAfterMinutes).toBe(90);
  });
});
