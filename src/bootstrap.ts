import { loadEnv } from "./core/home.js";

// Apps check an engine by running its whole configured command with --version ("pine-computer acp --version").
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log("pine-computer 0.1.0");
  process.exit(0);
}

loadEnv();
