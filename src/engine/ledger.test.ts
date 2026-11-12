import { describe, expect, it } from "vitest";
import { config, updateConfig } from "./config";
import { available, balance, reserve, settle, transfer, worldCommitted } from "./ledger";
import { moveIn } from "./residents";

let next = 0;
const newResident = () => moveIn({ name: `Ledger ${String.fromCharCode(65 + next++)}`, kind: "native", trade: "scribe" }).id;

describe("energy", () => {
  it("gives a resident who moves in one allowance", () => {
    const r = newResident();
    expect(balance(r)).toBe(config().allowance);
    expect(available(r)).toBe(config().allowance);
  });

  it("holds a waking's worst case, then charges only what it cost", () => {
    const r = newResident();
    const spentBefore = worldCommitted().spent;
    const hold = reserve(r, 0.4, "ep_test");
    if ("refused" in hold) throw new Error(hold.refused);
    expect(available(r)).toBe(0.6);
    expect(balance(r)).toBe(1);

    settle(hold.id, 0.1234, "waking ep_test");
    expect(balance(r)).toBe(0.8766);
    expect(available(r)).toBe(0.8766);
    expect(worldCommitted().spent).toBeCloseTo(spentBefore + 0.1234, 6);
  });

  it("refuses work a resident can't cover", () => {
    const r = newResident();
    const first = reserve(r, 0.7, "ep_a");
    expect("id" in first).toBe(true);
    const second = reserve(r, 0.4, "ep_b");
    expect(second).toEqual({ refused: expect.stringContaining("needs $0.40") });
    expect(available(r)).toBe(0.3);
  });

  it("refuses work past the habitat's budget for the day", () => {
    const before = config();
    const a = newResident();
    const b = newResident();
    const committed = worldCommitted();
    updateConfig({ dayBudget: committed.spent + committed.reserved + 0.5 });
    try {
      expect("id" in reserve(a, 0.4, "ep_c")).toBe(true);
      expect(reserve(b, 0.4, "ep_d")).toEqual({ refused: "the habitat's budget for today is spent" });
    } finally {
      updateConfig({ dayBudget: before.dayBudget });
    }
  });

  it("moves energy between residents without making any", () => {
    const a = newResident();
    const b = newResident();
    transfer(a, b, 0.25, "payment", "c_test", "test");
    expect(balance(a)).toBe(0.75);
    expect(balance(b)).toBe(1.25);
  });
});
