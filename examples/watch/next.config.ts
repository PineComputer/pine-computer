import type { NextConfig } from "next";

const config: NextConfig = {
  // The server SDK holds the project key and Computer credentials. It runs only in
  // route handlers, as Node loads it, and never reaches a browser bundle.
  serverExternalPackages: ["@pinesandbox/computer"],
  // Keep the project's files its own: no generated AGENTS.md.
  agentRules: false,
  // The development badge would sit over the composer.
  devIndicators: false,
};

export default config;
