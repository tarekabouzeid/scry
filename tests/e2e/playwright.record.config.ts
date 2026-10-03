import { defineConfig, devices } from "@playwright/test";

// Records the demo browse (see scripts/demo-gif.mjs).
export default defineConfig({
  testDir: "screenshots",
  testMatch: "**/*.record.ts",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    colorScheme: "dark",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
