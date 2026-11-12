import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The engine is server code; outside Next.js the marker has nothing to guard.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: { include: ["src/**/*.test.ts"], setupFiles: ["src/test/setup.ts"] },
});
