import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  process.env.TESTER_SECRET = "a-secret-long-enough-for-the-test";
});

test("a sealed secret opens again, and never reads as itself", async () => {
  const { open, seal } = await import("./store");
  const sealed = seal("ps_token");
  expect(sealed).not.toContain("ps_token");
  expect(open(sealed)).toBe("ps_token");
  expect(seal("ps_token")).not.toBe(sealed);
});

test("a saved screen's name can't leave the run's folder", async () => {
  const { storedScreen } = await import("./store");
  expect(storedScreen("r-1", "24.webp")).toMatch(/screens\/r-1\/24\.webp$/);
  expect(() => storedScreen("r-1", "../store.json")).toThrow();
});
