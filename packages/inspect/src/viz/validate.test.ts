import { toViz } from "../structure.ts";
import { exampleInputs, exampleTargets } from "../examples.ts";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-viz.ts";
import { VIZ_SCHEMA_VERSION, serializeViz, parseViz } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

describe("parseViz", () => {
  test("round-trips every exported example", () => {
    const viz = toViz(exampleInputs());
    const parsed = parseViz(serializeViz(viz));
    expect(Either.getRight(parsed)).toEqual(viz);
  });

  test("round-trips fuzzed machines, including null payloads", () => {
    const machines = exampleTargets().map((target) =>
      fuzzedMachine(target, fuzz(target, { seed: 3, iterations: 300 })),
    );
    const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines };
    expect(Either.getRight(parseViz(serializeViz(viz)))).toEqual(viz);
  });
});
