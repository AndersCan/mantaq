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
    // Grayscale text AA everywhere: the GitHub runner image enables LCD
    // subpixel rendering, which drifts goldens vs the minimal ubuntu:24.04
    // container used to generate them.
    launchOptions: {
      args: ["--disable-lcd-text"],
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
    // CI pre-builds via `vp run -F @mantaq/viz browser:build` and serves the
    // dist with a node static server. Spawning `vp` from playwright fails on
    // GitHub runners (EINVAL, os error 22) when vp spawns its build child.
    command: CI ? "node preview-server.mjs" : "vp run serve:test",
    url: "http://localhost:4173",
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
