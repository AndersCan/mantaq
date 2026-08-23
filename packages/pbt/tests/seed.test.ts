import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("seed configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("uses default seed when MANTAQ_SEED is empty", async () => {
    vi.stubEnv("MANTAQ_SEED", "");

    const { DEFAULT_SEED, fc } = await import("../src/index.ts");

    expect(fc.readConfigureGlobal().seed).toBe(DEFAULT_SEED);
  });

  test("accepts an integer MANTAQ_SEED", async () => {
    vi.stubEnv("MANTAQ_SEED", "42");

    const { fc } = await import("../src/index.ts");

    expect(fc.readConfigureGlobal().seed).toBe(42);
  });
});
