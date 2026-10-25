import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
/** Point the run at another server (for example a checkout of an older commit) with this. */
const EXTERNAL = process.env.E2E_BASE_URL;

/**
 * Real-browser checks of the Ask screen (geometry, screenshots, streaming control). The app runs
 * as `vite dev`; every network call the screen makes is answered by the harness in
 * `e2e/support/ask-harness.ts`, so no credentials, database or model are needed. Unit and DOM
 * tests stay in Vitest (`bun run test`); this runner only picks up `e2e/**\/*.spec.ts`.
 *
 * Reduced motion and a fixed locale and time zone keep screenshots reproducible. Screenshot
 * baselines are per browser and per platform (Playwright's default snapshot path), because font
 * rasterisation differs: portable layout rules are asserted as geometry, not as pixels.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/support/warm-up.ts",
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${PORT}`,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    trace: "off",
  },
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], deviceScaleFactor: 1 } },
    { name: "webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 } },
  ],
  webServer:
    EXTERNAL === undefined
      ? {
          command: `bun run dev -- --port ${PORT}`,
          url: `http://localhost:${PORT}/ask`,
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
});
