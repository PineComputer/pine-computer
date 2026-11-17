import { describe, expect, it } from "vitest";
import { anglesFrom, checkCites, cite, jsonIn, markdown, notesFrom, reportFrom, sameAs, type Reading } from "./notes";

const angle = (n: number) => ({ id: `a${n}`, title: `Angle ${n}`, focus: "" });

describe("jsonIn", () => {
  it("reads a file's JSON and an answer that wraps one", () => {
    expect(jsonIn('{"a":1}')).toEqual({ a: 1 });
    expect(jsonIn('Here it is:\n```json\n{"a":[1,2]}\n```\nDone.')).toEqual({ a: [1, 2] });
    expect(jsonIn("no object")).toBeUndefined();
    expect(jsonIn("{broken")).toBeUndefined();
  });
});

describe("anglesFrom", () => {
  it("keeps at most three titled angles", () => {
    const angles = anglesFrom({ angles: [{ title: "One", focus: "f" }, { title: "" }, { title: "Two" }, { title: "Three" }, { title: "Four" }] });
    expect(angles.map((a) => a.title)).toEqual(["One", "Two", "Three"]);
    expect(anglesFrom("nonsense")).toEqual([]);
  });
});

describe("sameAs", () => {
  it("ignores the scheme, www, the fragment and a trailing slash", () => {
    expect(sameAs("https://www.Deno.com/docs/#top")).toBe(sameAs("http://deno.com/docs"));
    expect(sameAs("https://a.dev/p?x=1")).not.toBe(sameAs("https://a.dev/p?x=2"));
    expect(sameAs("https://a.dev/p?x=1", true)).toBe(sameAs("https://a.dev/p?x=2", true));
  });
});

describe("cite", () => {
  const readings: Reading[] = [
    {
      run: "r-1",
      reader: "r1",
      angle: angle(1),
      pages: [{ url: "https://docs.deno.com/runtime/fundamentals/security/", title: "Security", shot: "4.webp" }],
      notes: notesFrom({
        summary: "s",
        findings: [
          { text: "Deno denies by default.", url: "https://docs.deno.com/runtime/fundamentals/security#permissions" },
          { text: "Invented.", url: "https://example.com/never-opened" },
        ],
      }),
    },
    {
      run: "r-2",
      reader: "r2",
      angle: angle(2),
      pages: [
        { url: "https://docs.deno.com/runtime/fundamentals/security/", title: "Security", shot: "9.webp" },
        { url: "https://nodejs.org/api/permissions.html", title: "Permissions", shot: "12.webp" },
      ],
      notes: notesFrom({ findings: [{ text: "Node has a flag.", url: "https://nodejs.org/api/permissions.html" }, { text: "Again.", url: "https://docs.deno.com/runtime/fundamentals/security/" }] }),
    },
  ];

  it("numbers each opened page once and drops claims whose page was never opened", () => {
    const { sources, cited } = cite(readings);
    expect(sources.map((s) => [s.n, s.host, s.run, s.shot])).toEqual([
      [1, "docs.deno.com", "r-1", "4.webp"],
      [2, "nodejs.org", "r-2", "12.webp"],
    ]);
    expect(cited[0]).toMatchObject({ dropped: 1, findings: [{ n: 1 }] });
    expect(cited[1].findings.map((f) => f.n)).toEqual([2, 1]);
  });

  it("checks the writer's citations against the sources", () => {
    const { sources } = cite(readings);
    expect(checkCites("True [1][7], and [2, 9].", sources.length)).toBe("True [1], and [2].");
    const report = reportFrom({ title: "T", answer: "Yes [1] [5].", sections: [{ angle: "a2", body: "Body [2]." }, { angle: "zz", body: "" }] }, [angle(1), angle(2)], sources);
    expect(report?.answer).toBe("Yes [1] .");
    expect(report?.sections).toEqual([{ angle: "a2", title: "Angle 2", body: "Body [2]." }]);
    expect(reportFrom({ answer: "" }, [angle(1)], sources)).toBeUndefined();
    expect(markdown("Q?", report!, () => "Reader 1")).toContain("1. [Security](https://docs.deno.com/runtime/fundamentals/security/) · docs.deno.com · opened by Reader 1");
  });
});
