import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src/conform",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/signup-page/**",
  use: {
    actionTimeout: 5_000,
    launchOptions: { executablePath: process.env["CHROMIUM_PATH"] || undefined },
  },
});
