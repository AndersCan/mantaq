import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    contextOptions: {
      reducedMotion: "reduce",
    },
  },
  snapshotPathTemplate: "{testDir}/__snapshots__/{platform}/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  webServer: {
    command:
      "pwd; echo VP=$(which vp); env | grep -E '^(CI|PATH|VP|VITE|npm_)' | head -8; vp run serve:test",
    url: "http://localhost:4173",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
