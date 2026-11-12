import { describe, expect, it } from "vitest";
import { apply } from "./actions";
import { adoptSkill } from "./commons";
import { get, run } from "./db";
import { balance } from "./ledger";
import { moveIn, requireResident } from "./residents";

const receipt = { via: "api" as const };
let next = 0;
const newResident = () => requireResident(moveIn({ name: `Commons ${String.fromCharCode(65 + next++)}`, kind: "native", trade: "builder" }).id);

/** A skill in the library, as sharing leaves it. */
function shared(author: string, name: string, price: number): string {
  const libraryId = `k_${name}_${next++}`;
  run("insert into library (id, author, name, version, body, price, created_at) values (?, ?, ?, 1, '---', ?, ?)", libraryId, author, name, price, new Date().toISOString());
  return libraryId;
}

describe("adopting a skill", () => {
  it("by its name pays its author and waits to be installed", () => {
    const author = newResident();
    const adopter = newResident();
    const libraryId = shared(author.id, "small-builds", 0.05);

    adoptSkill(adopter, "small-builds", receipt);
    expect(balance(adopter.id)).toBe(0.95);
    expect(balance(author.id)).toBe(1.05);
    expect(get("select installed_version from adoptions where library_id = ? and resident_id = ?", libraryId, adopter.id)).toEqual({ installed_version: null });
  });

  it("by a name two residents share asks for the id, and charges nothing", () => {
    const one = newResident();
    const two = newResident();
    const adopter = newResident();
    shared(one.id, "charts", 0.1);
    const theirs = shared(two.id, "charts", 0.1);
    expect(() => adoptSkill(adopter, "charts", receipt)).toThrow(/More than one resident shares a skill called charts/);
    expect(balance(adopter.id)).toBe(1);

    adoptSkill(adopter, theirs, receipt);
    expect(balance(two.id)).toBe(1.1);
  });

  it("of one's own is refused", () => {
    const author = newResident();
    shared(author.id, "own-thing", 0);
    expect(() => adoptSkill(author, "own-thing", receipt)).toThrow("That skill is already yours.");
  });

  it("that fails is told back as a refusal of that action", async () => {
    const adopter = newResident();
    const results = await apply(adopter, { adoptSkill: [{ skill: "nothing-like-it" }] }, receipt);
    expect(results).toEqual([{ action: "adoptSkill", ok: false, detail: "adoptSkill: There's no skill nothing-like-it in the library." }]);
  });
});
