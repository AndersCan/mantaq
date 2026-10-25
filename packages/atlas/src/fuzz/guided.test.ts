import { annotateMachine } from "../ast/annotate.ts";
import { toAtlasMachine } from "../atlas.ts";
import { EXAMPLE_ROOT, exampleTargets } from "../examples.ts";
import type { Example } from "../examples.ts";
import type { AtlasComparison, AtlasMachine } from "../schema.ts";
import { compareArms, renderComparison } from "./compare.ts";
import { fuzz } from "./fuzz.ts";
import { branchDistance, guidance, literalPool } from "./guided.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { describe, expect, test } from "vite-plus/test";

function credit(): { example: Example; machine: AtlasMachine } | undefined {
  const example = exampleTargets().find((each) => each.id === "credit");
  if (!example) return undefined;
  const machine = annotateMachine(
    toAtlasMachine({ id: example.id, actor: example.create().actor }),
    {
      file: example.source,
      root: EXAMPLE_ROOT,
    },
  );
  return { example, machine };
}

function compare(operator: AtlasComparison["operator"], literal: number | string): AtlasComparison {
  return { source: "payload", path: "x", operator, literal };
}

describe("branch distance", () => {
  test.each([
    ["<", 600, 720, 121, 0],
    ["<", 600, 599, 0, 1],
    ["<=", 600, 600, 0, 1],
    [">", 50000, 1000, 49001, 0],
    [">", 50000, 50001, 0, 1],
    [">=", 10, 7, 3, 0],
    ["===", 5, 8, 3, 0],
    ["!==", 5, 5, 1, 0],
  ] as const)(
    "%s %d with value %d: true %d, false %d",
    (operator, literal, value, whenTrue, whenFalse) => {
      expect(branchDistance(compare(operator, literal), { value, outcome: true })).toBe(whenTrue);
      expect(branchDistance(compare(operator, literal), { value, outcome: false })).toBe(whenFalse);
    },
  );

  test("strings: per-character distance to equality", () => {
    expect(branchDistance(compare("===", "gold"), { value: "gild", outcome: true })).toBe(1);
    expect(branchDistance(compare("===", "gold"), { value: "gold", outcome: false })).toBe(1);
    expect(branchDistance(compare("!==", "gold"), { value: "silver", outcome: true })).toBe(0);
  });

  test("incomparable values have no distance", () => {
    expect(branchDistance(compare("<", 600), { value: "720", outcome: true })).toBeUndefined();
    expect(branchDistance(compare("<", "a"), { value: "b", outcome: true })).toBeUndefined();
  });
});

describe("literal seeding", () => {
  test("pool holds every compared literal and its neighbours", () => {
    const loaded = credit();
    expect(loaded && literalPool(loaded.machine)).toEqual({
      numbers: [599, 600, 601, 49999, 50000, 50001],
      strings: ["gold"],
    });
  });

  test("guided fuzzing reaches the far branch blind fuzzing misses (same seed)", () => {
    const loaded = credit();
    if (!loaded) return;
    const feature = "edge:idle>apply>manualReview";
    const blind = fuzz(loaded.example, { seed: DEFAULT_SEED, iterations: 2000 });
    const guided = fuzz(loaded.example, {
      seed: DEFAULT_SEED,
      iterations: 2000,
      ...guidance(loaded.machine),
    });
    expect(blind.firstHit.has(feature)).toBe(false);
    expect(guided.firstHit.get(feature)).toBeLessThan(200);
  });

  test("guided runs are deterministic too", () => {
    const loaded = credit();
    if (!loaded) return;
    const run = () =>
      fuzz(loaded.example, { seed: 9, iterations: 400, ...guidance(loaded.machine) }).corpus;
    expect(run()).toEqual(run());
  });
});

describe("comparison report", () => {
  test("renders every arm per example", () => {
    const loaded = credit();
    if (!loaded) return;
    const row = compareArms(loaded.example, {
      machine: loaded.machine,
      seeds: [1, 2],
      checkpoints: [10, 50],
    });
    expect(row.arms.map((arm) => arm.arm)).toEqual([
      "no-loop",
      "blind",
      "literals",
      "distance",
      "guided",
    ]);
    const report = renderComparison([row]);
    expect(report).toContain("### credit");
    expect(report).toMatch(/^\| guided \| /m);
  });
});
