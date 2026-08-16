/**
 * graph-model failure paths: a throwing buildGraph becomes a typed error the
 * UI renders; a missing actor is a typed error (never an empty graph
 * silently).
 */

import { describe, expect, it } from "vite-plus/test";
import { createThrowingContextActor } from "../browser/fixtures/synthetic/edge-cases.ts";
import { buildVizGraph } from "../src/index.ts";

describe("buildVizGraph — failure paths", () => {
  it("missing actor → missing-actor error", () => {
    const result = buildVizGraph(undefined);
    expect(result).toEqual({
      status: "error",
      reason: "missing-actor",
      message: "actor is null or undefined",
    });
  });

  it("throwing context getter → handler-threw error (never silent empty graph)", () => {
    // buildGraph spreads `{...actor.context}` for the sample context; the
    // getter throws — that is the sanctioned untrusted-value boundary.
    const { actor } = createThrowingContextActor();
    const result = buildVizGraph(actor);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("handler-threw");
      expect(result.message).toMatch(/boom/);
    }
  });
});
