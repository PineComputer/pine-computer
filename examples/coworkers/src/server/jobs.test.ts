import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dataDir = await mkdtemp(path.join(tmpdir(), "coworkers-jobs-"));
process.env.COWORKERS_DATA_DIR = dataDir;
process.env.COWORKERS_SECRET = "a-secret-for-the-tests-only";
const { open, read, seal } = await import("./store");
const { context, scaffold } = await import("./jobs");
const { storedFile } = await import("./turns");
const { secretValues, setSecret, listSecrets } = await import("./vault");

afterAll(() => rm(dataDir, { recursive: true, force: true }));

describe("the store", () => {
  it("starts a new workspace with three coworkers and no Computers", async () => {
    const { coworkers, threads } = await read();
    expect(coworkers.map((c) => c.name)).toEqual(["Ada", "Otto", "Vera"]);
    expect(coworkers.every((c) => c.computer === undefined && c.suggestion)).toBe(true);
    expect(threads).toEqual([]);
  });

  it("seals a secret so that only the key opens it", () => {
    const sealed = seal("credentials");
    expect(sealed).not.toContain("credentials");
    expect(open(sealed)).toBe("credentials");
  });
});

describe("context", () => {
  const ada = { name: "Ada", role: "Researcher", brief: "Finds things out." };

  it("carries the coworker's role and brief, and the approval rule", () => {
    const text = context(ada);
    expect(text).toContain("You are Ada, the researcher on this team. Finds things out.");
    expect(text).toContain("Approval needed:");
    expect(text).not.toContain("Earlier in this thread");
  });

  it("tells a freshly opened session what the thread already covered", () => {
    const text = context(ada, [{ ask: "Top stories?", summary: "Three stories." }]);
    expect(text).toContain("- Asked: Top stories?");
    expect(text).toContain("You answered: Three stories.");
  });
});

describe("scaffold", () => {
  it("tells the skill author what the job was for, and what the person added", () => {
    const text = scaffold("Quotes PDF", "Collect the quotes\nand make a PDF.", "Any site with quotes.");
    expect(text).toContain("# Quotes PDF");
    expect(text).toContain("> Collect the quotes\n> and make a PDF.");
    expect(text).toContain("Any site with quotes.");
    expect(scaffold("Quotes PDF", "Collect the quotes")).not.toContain("From the person");
  });
});

describe("storedFile", () => {
  it("keeps a returned file inside its job's folder", () => {
    expect(storedFile("job-1", "out/report.pdf")).toBe(path.join(dataDir, "files", "job-1", "out", "report.pdf"));
    expect(() => storedFile("job-1", "../job-2/report.pdf")).toThrow();
  });
});

describe("the vault", () => {
  it("lists names and never values", async () => {
    await setSecret({ name: "CRM_PASSWORD", value: "hunter2", note: "The CRM" });
    expect(JSON.stringify(await listSecrets())).not.toContain("hunter2");
    expect(await secretValues()).toEqual({ CRM_PASSWORD: "hunter2" });
    expect(JSON.stringify(await read())).not.toContain("hunter2");
  });

  it("refuses a name a shell couldn't use", async () => {
    await expect(setSecret({ name: "my key", value: "x" })).rejects.toThrow();
  });
});
