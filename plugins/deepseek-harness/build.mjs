// Builds the plugin into lib/, with the pine-computer core (../../src) compiled in. dsh loads a plugin as an
// installed package, from a registry, a tarball, a git checkout or a link, and in none of those can it
// reach files outside the package: so the core travels inside it, and only npm packages stay imports.
//
// The entry points share their code as chunks in lib/. That matters for the desktop pages: the core tells
// a running viewer from a stale one by the file its code is in, and the plugin and the viewer process it
// starts must agree on that file.

import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const here = new URL("./", import.meta.url);
const path = (relative) => new URL(relative, here).pathname;

await rm(path("lib"), { recursive: true, force: true });
await build({
  absWorkingDir: path("."),
  entryPoints: { index: "src/index.ts", skill: "src/skill.ts", viewer: "src/viewer.ts" },
  outdir: "lib",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});

// The one skill of the repository, read by src/skill.ts from the package's own files.
await mkdir(path("assets/pine-computer"), { recursive: true });
await cp(path("../../skills/pine-computer/SKILL.md"), path("assets/pine-computer/SKILL.md"));
