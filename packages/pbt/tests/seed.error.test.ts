import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("seed configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test.each(["not-a-number", "1.5", "Infinity"])(
    "rejects invalid MANTAQ_SEED value %s",
    async (raw) => {
      vi.stubEnv("MANTAQ_SEED", raw);

      await expect(import("../src/index.ts")).rejects.toThrow(
        `MANTAQ_SEED must be an integer, got ${JSON.stringify(raw)}`,
      );
    },
  );
});
