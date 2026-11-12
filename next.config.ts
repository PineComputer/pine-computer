import type { NextConfig } from "next";

const config: NextConfig = {
  // The server SDK holds the project key and the Computer's credentials: it runs only in route handlers.
  serverExternalPackages: ["@pinesandbox/computer"],
  agentRules: false,
  devIndicators: false,
};

export default config;
