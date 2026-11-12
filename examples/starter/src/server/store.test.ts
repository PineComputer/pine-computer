import { describe, expect, it } from "vitest";
import { upgrade } from "./store";
import { LOCAL_USER } from "./user";

describe("upgrade", () => {
  it("moves a first-version file's Computer, session and turns to the local user", () => {
    const v1 = {
      computer: { id: "c1", credentials: "sealed-credentials", binding: "sealed-binding", bindingRevision: "7" },
      session: { name: "main", token: "sealed-token", bindingRevision: "7" },
      turns: [{ turnId: "t1", runKey: "k", kind: "run", ask: "Do it", askedAt: "2026-10-17T00:00:00Z", state: "completed" }],
    };
    const data = upgrade(v1);
    const user = data.users[LOCAL_USER];
    expect(data.version).toBe(2);
    // The credentials are the only way to start the Computer again: they carry over untouched.
    expect(user.computer).toEqual(v1.computer);
    expect(user.sessions).toEqual([expect.objectContaining({ name: "main", label: "Main", token: "sealed-token", bindingRevision: "7" })]);
    expect(user.turns).toEqual([expect.objectContaining({ turnId: "t1", session: "main" })]);
    expect(user.secrets).toEqual([]);
    expect(user.schedules).toEqual([]);
  });

  it("leaves a current file as it is", () => {
    const v2 = { version: 2, users: {} };
    expect(upgrade(v2)).toBe(v2);
  });
});
