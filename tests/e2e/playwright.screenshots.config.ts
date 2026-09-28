import { defineConfig, devices } from "@playwright/test";

// Captures docs/screenshots from the seeded demo (see scripts/screenshots.mjs).
export default defineConfig({
  testDir: "screenshots",
  testMatch: "**/*.shots.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
