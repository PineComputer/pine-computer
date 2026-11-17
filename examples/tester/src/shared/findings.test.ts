import { expect, test } from "vitest";
import type { Screen } from "./api";
import { tally } from "./api";
import { evidenceFor, parseCheck, samePage } from "./findings";

const screen = (name: string, url: string): Screen => ({ name, at: "2026-01-01T00:00:00Z", caption: "Open a page", url });

test("a recorded check is read, also from inside a code fence", () => {
  const raw = '```json\n{"n": 2, "title": "Cart badge", "status": "Failed", "expected": "2", "observed": "1", "url": "https://shop.test/inventory.html", "where": "top right", "steps": ["Sign in", "Add two items"]}\n```';
  expect(parseCheck(raw, 2)).toEqual({ n: 2, title: "Cart badge", status: "failed", expected: "2", observed: "1", url: "https://shop.test/inventory.html", where: "top right", steps: ["Sign in", "Add two items"] });
});

test("a file that isn't a check is refused", () => {
  expect(parseCheck("not json", 1)).toBeNull();
  expect(parseCheck('{"title": "No verdict", "status": "maybe"}', 1)).toBeNull();
});

test("two addresses name one page whatever follows the path", () => {
  expect(samePage("https://www.shop.test/cart.html?x=1", "https://shop.test/cart.html#top")).toBe(true);
  expect(samePage("https://shop.test/cart.html", "https://shop.test/inventory.html")).toBe(false);
  expect(samePage("the cart page", "https://shop.test/cart.html")).toBe(false);
});

test("the evidence is the last screen of the page the finding names", () => {
  const saved = [screen("1.webp", "https://shop.test/"), screen("2.webp", "https://shop.test/inventory.html"), screen("3.webp", "https://shop.test/cart.html")];
  expect(evidenceFor({ url: "https://shop.test/cart.html" }, saved, 1)).toEqual({ screens: ["2.webp", "3.webp"], evidence: "3.webp" });
  // The check was recorded after the agent moved on: the picture of its page is still the evidence.
  expect(evidenceFor({ url: "https://shop.test/inventory.html" }, saved, 2)).toEqual({ screens: ["2.webp", "3.webp"], evidence: "2.webp" });
});

test("a finding whose page no screen shows has no evidence", () => {
  const saved = [screen("1.webp", "https://shop.test/")];
  expect(evidenceFor({ url: "https://shop.test/checkout.html" }, saved, 1)).toEqual({ screens: ["1.webp"], evidence: undefined });
});

test("the summary line counts the failures", () => {
  expect(tally([{ status: "passed" }, { status: "failed" }, { status: "failed" }]).words).toBe("3 checks, 2 failed");
  expect(tally([{ status: "passed" }]).words).toBe("1 check, all passed");
});
