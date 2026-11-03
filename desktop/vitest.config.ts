import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same `@shared` alias as the renderer build, for renderer modules that tests import directly.
  resolve: { alias: { "@shared": path.resolve(__dirname, "src/shared"), "@content": path.resolve(__dirname, "../content") } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup-locale.ts"],
    testTimeout: 20000,
    pool: "forks",
  },
});
