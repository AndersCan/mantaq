/**
 * Public-path contract test (plan §3 + §9.6, Phase 1): every export declared
 * in `src/index.ts` must resolve through the package path — the v1 audit #3
 * failure was `buildGraph` being `undefined` through `@mantaq/viz`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as pkg from "../src/index.ts";
import * as core from "../src/core/index.ts";

describe("public package path", () => {
  it("every value export in src/index.ts resolves (not undefined)", () => {
    const exports = Object.keys(pkg);
    expect(exports.length).toBeGreaterThan(0);
    for (const name of exports) {
      expect((pkg as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("exports the Phase 1 vertical slice through @mantaq/viz", () => {
    expect(pkg.buildVizGraph).toBeDefined();
    expect(pkg.layoutGraph).toBeDefined();
  });

  it("@mantaq/viz/core entry resolves the same functions", () => {
    expect(core.buildVizGraph).toBe(pkg.buildVizGraph);
    expect(core.layoutGraph).toBe(pkg.layoutGraph);
  });

  it("buildVizGraph returns an error result for a missing actor (empty render path)", () => {
    const result = pkg.buildVizGraph(undefined);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("missing-actor");
      expect(result.message).toMatch(/actor/);
    }
  });
});
