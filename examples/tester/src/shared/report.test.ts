import { expect, test } from "vitest";
import type { Finding } from "./api";
import { fileName, markdown } from "./report";

const found = (n: number, status: Finding["status"], evidence?: string): Finding => ({
  n,
  title: `Check ${n}`,
  status,
  expected: "The badge reads 2",
  observed: "The badge reads 1 | one item was not added",
  url: "https://shop.test/inventory.html",
  where: "top right",
  steps: ["Sign in", "Add two items"],
  at: "2026-11-13T10:00:00Z",
  screens: [],
  evidence,
});

const run = { target: "https://www.shop.test", checks: "sign in\nadd two items", askedAt: new Date(2026, 10, 13, 10).toISOString(), state: "completed", findings: [found(1, "passed", "24.webp"), found(2, "failed")], moments: [] };

test("the report leads with the count and lists failures first", () => {
  const text = markdown(run);
  expect(text).toContain("# Test report: shop.test");
  expect(text).toContain("**2 checks, 1 failed.**");
  expect(text.indexOf("## Failed")).toBeLessThan(text.indexOf("## Passed"));
  expect(text).toContain("| 2 | Check 2 | failed |");
  expect(text).toContain("The badge reads 1 \\| one item was not added");
});

test("a finding says which screen is its evidence, or that it has none", () => {
  const text = markdown(run);
  expect(text).toContain("the Computer's screen on that page");
  expect(text).toContain("none; no saved screen shows that page");
});

test("the file is named after the target and the day", () => {
  expect(fileName(run)).toBe("shop.test-2026-11-13.md");
});
