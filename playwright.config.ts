import { defineConfig, devices } from "@playwright/test";

/** UI smoke tests against a running app (BASE_URL, default http://localhost:3000). Install browsers: npx playwright install chromium */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
