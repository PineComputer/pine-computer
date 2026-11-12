// Builds the desktop app's parts: the UI (Vite), and the engine and the Electron shell,
// each bundled into one file with its packages, so the app ships no node_modules.
import { execSync } from "node:child_process";
import { build } from "esbuild";

execSync("npx vite build", { stdio: "inherit" });

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "linked",
  logLevel: "info",
  // Some packages still call require(); give the ES module bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};

await build({ ...shared, entryPoints: ["src/engine/main.ts"], outfile: "dist/desktop/engine.mjs" });
await build({ ...shared, entryPoints: ["desktop/main.ts"], outfile: "dist/desktop/main.mjs", external: ["electron"] });
