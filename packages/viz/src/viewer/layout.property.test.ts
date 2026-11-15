import { machineArbitrary } from "./layout.arbitrary.ts";
import { layoutMachine, placeMachine } from "./layout.ts";
import { overlapLines, overlapsOf } from "./overlaps.ts";
import { Either } from "@mantaq/utils";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

const run = { seed: 0x700, numRuns: 300, endOnFailure: false };

describe("layout guarantee on generated machines", () => {
  test("P1: layoutMachine is Right and the checker finds nothing", () => {
    fc.assert(
      fc.property(machineArbitrary, (machine) => {
        const overlaps = overlapsOf(placeMachine(machine));
        if (overlaps.length > 0) console.log(JSON.stringify(machine), overlapLines(overlaps));
        expect(overlaps).toEqual([]);
        expect(Either.isRight(layoutMachine(machine))).toBe(true);
      }),
      run,
    );
  });
});
