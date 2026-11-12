import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SideBySide } from "./SideBySide.tsx";

describe("two documents side by side", () => {
  it("gives each a column of its own, even when a document renders several elements", () => {
    // A document view renders its download link and its body as siblings (a Fragment): unwrapped, each took a grid cell.
    const doc = (name: string) => createElement(Fragment, null, createElement("a", null, `download ${name}`), createElement("pre", null, name));
    const html = renderToStaticMarkup(createElement(SideBySide, { left: doc("original"), right: doc("rewrite") }));
    expect(html).toBe('<div class="side-by-side"><div class="side-doc"><a>download original</a><pre>original</pre></div><div class="side-doc"><a>download rewrite</a><pre>rewrite</pre></div></div>');
  });
});
