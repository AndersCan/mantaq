import counterexamples from "./reference/property-counterexamples.json" with { type: "json" };
import { machineArbitrary } from "./layout.arbitrary.ts";
import { layoutMachine, placeMachine } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import type { VizMachine } from "../schema.ts";
import { Either } from "@mantaq/utils";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

const examples = (counterexamples as VizMachine[]).map((machine) => [machine] as [VizMachine]);
const run = { seed: 0x700, numRuns: 300, examples };

describe("layout guarantee on generated machines", () => {
  test("P1: layoutMachine is Right and the checker finds nothing", () => {
    fc.assert(
      fc.property(machineArbitrary, (machine) => {
        expect(overlapsOf(placeMachine(machine))).toEqual([]);
        expect(Either.isRight(layoutMachine(machine))).toBe(true);
      }),
      run,
    );
  }, 30_000);
});
