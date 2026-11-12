import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dataDir = await mkdtemp(path.join(tmpdir(), "starter-turns-"));
process.env.STARTER_DATA_DIR = dataDir;
const { readUser } = await import("./store");
const { storedFile, sync } = await import("./turns");
type Session = Parameters<typeof sync>[1];

afterAll(() => rm(dataDir, { recursive: true, force: true }));

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("sync", () => {
  it("records a finished turn and copies each file it returned from the working directory", async () => {
    const workDir: Record<string, string> = { "out/report.csv": "a,b\n1,2\n", "notes.md": "# Done\n" };
    const turn = {
      turnId: "t1",
      state: "completed",
      startedAt: new Date("2026-10-21T10:00:00Z"),
      endedAt: new Date("2026-10-21T10:00:02Z"),
      result: {
        summary: "Wrote [the report](out/report.csv).",
        artifacts: [
          { relativePath: "out/report.csv", size: 8, sha256: "x", contentType: "text/csv" },
          { relativePath: "notes.md", size: 7, sha256: "y", contentType: "text/markdown" },
        ],
        usage: { duration: { totalMs: 2000 }, cost: { total: 0.01 } },
      },
    };
    // Only what a turn's files need: the artifact store is not part of it.
    const session = {
      name: "main",
      agent: { wait: async () => turn },
      openFile: async (relativePath: string) => streamOf(workDir[relativePath]),
    } as unknown as Session;

    const record = await sync("u1", session, "t1");

    expect(record).toMatchObject({ state: "completed", summary: "Wrote [the report](out/report.csv).", durationMs: 2000, cost: 0.01 });
    expect(record?.files).toEqual([
      { path: "out/report.csv", size: 8, contentType: "text/csv" },
      { path: "notes.md", size: 7, contentType: "text/markdown" },
    ]);
    expect(await readFile(storedFile("u1", "t1", "out/report.csv"), "utf8")).toBe("a,b\n1,2\n");
    expect(await readFile(storedFile("u1", "t1", "notes.md"), "utf8")).toBe("# Done\n");
    expect((await readUser("u1")).turns).toEqual([expect.objectContaining({ turnId: "t1", files: record?.files })]);
  });
});
