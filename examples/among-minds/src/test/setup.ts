// Each test file gets an empty habitat of its own, in a directory removed afterwards.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "habitat-test-"));
process.env.HABITAT_DATA_DIR = dir;
process.env.HABITAT_SECRET = "a-test-secret-of-some-length";

afterAll(() => {
  const shared = globalThis as typeof globalThis & { __habitatDb?: { close(): void } };
  shared.__habitatDb?.close();
  delete shared.__habitatDb;
  rmSync(dir, { recursive: true, force: true });
});
