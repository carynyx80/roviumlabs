import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside React Server Components; tests run in plain Node.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/contracts/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false, // integration tests share one test database
  },
});
