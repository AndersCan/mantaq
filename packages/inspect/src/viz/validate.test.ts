import { toViz } from "../structure.ts";
import { exampleInputs, exampleTargets } from "../examples.ts";
import { fuzz } from "../fuzz/fuzz.ts";
import { fuzzedMachine } from "../fuzz/to-viz.ts";
import { VIZ_SCHEMA_VERSION, serializeViz, parseViz } from "@mantaq/viz";
import type { VizDocument } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

describe("parseViz runs", () => {
  const withRuns = (runs: unknown): string => {
    const [machine] = toViz(exampleInputs()).machines;
    return JSON.stringify({
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [{ ...machine, runs }],
    });
  };

  test("accepts named runs of events and advances", () => {
    const runs = [
      {
        name: "a",
        steps: [
          { kind: "event", event: "go", payload: { n: 1 } },
          { kind: "advance", ms: 5 },
        ],
      },
    ];
    const parsed = Either.getRight(parseViz(withRuns(runs)));
    expect(parsed?.machines[0]?.runs).toEqual(runs);
  });

  test("rejects a run without a name or with a bad step", () => {
    expect(Either.isLeft(parseViz(withRuns([{ steps: [] }])))).toBe(true);
    expect(Either.isLeft(parseViz(withRuns([{ name: "a", steps: [{ kind: "jump" }] }])))).toBe(
      true,
    );
    expect(Either.isLeft(parseViz(withRuns("nope")))).toBe(true);
  });
});

describe("parseViz", () => {
  test("round-trips every exported example", () => {
    const viz = toViz(exampleInputs());
    const parsed = parseViz(serializeViz(viz));
    expect(Either.getRight(parsed)).toEqual(viz);
  });

  test("keeps declared outputs", () => {
    const [machine] = toViz(exampleInputs()).machines;
    const text = JSON.stringify({
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [{ ...machine, outputs: ["x", "y"] }],
    });
    expect(Either.getRight(parseViz(text))?.machines[0]?.outputs).toEqual(["x", "y"]);
  });

  test("round-trips fuzzed machines, including null payloads", () => {
    const machines = exampleTargets().map((target) =>
      fuzzedMachine(target, fuzz(target, { seed: 3, iterations: 300 })),
    );
    const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines };
    expect(Either.getRight(parseViz(serializeViz(viz)))).toEqual(viz);
  });
});
