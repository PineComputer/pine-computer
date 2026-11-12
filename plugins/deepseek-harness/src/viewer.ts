// The process that serves the live desktop pages for this plugin's install. The core starts it on first
// use and leaves it running, so a link the agent gave the person keeps working after dsh exits. It is the
// plugin's own copy of `pine-computer viewer`: the core starts "../cli.js viewer" from where its code is,
// which for this package is cli.js at its root, and that file loads this one.

import { loadEnv } from "../../../src/core/home.js";
import { serveViewer } from "../../../src/viewer/server.js";

if (process.argv[2] !== "viewer") {
  console.error("This serves the Pine Computer desktop pages for the dsh plugin. Usage: node cli.js viewer");
  process.exit(1);
}
loadEnv();
// "running": another process of this build already serves them, and this one has nothing to do.
if ((await serveViewer()) === "running") process.exit(0);
