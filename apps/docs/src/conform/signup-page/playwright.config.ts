import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: { actionTimeout: 5_000 },
});
