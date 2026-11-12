import type { NextConfig } from "next";

const config: NextConfig = {
  // The server SDK holds the project key and each home's credentials; it runs only on
  // the server, as Node loads it.
  serverExternalPackages: ["@pinesandbox/computer"],
  agentRules: false,
  devIndicators: false,
};

export default config;
