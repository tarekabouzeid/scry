import { defineConfig } from "vitest/config";

// API suites share one database and reset it to the demo story, so they run
// one file at a time.
export default defineConfig({
  test: {
    include: ["api/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
