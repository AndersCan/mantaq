import counterexamples from "./reference/property-counterexamples.json" with { type: "json" };
import { machineArbitrary, talkingArbitrary } from "./layout.arbitrary.ts";
import { layoutMachine, messagesOf } from "./layout.ts";
import type { VizMachine } from "../schema.ts";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

const examples = (counterexamples as VizMachine[]).map((machine) => [machine] as [VizMachine]);
const run = { seed: 0x700, numRuns: 300, examples };

describe("layout guarantee on generated machines", () => {
  test("P1: layoutMachine is Right and the checker finds nothing", () => {
    fc.assert(
      fc.property(machineArbitrary, (machine) => {
        expect(layoutMachine(machine)[1]?.overlaps).toEqual([]);
      }),
      run,
    );
  }, 30_000);

  test("P2: with messages between machines, layoutMachine is Right and the checker finds nothing", () => {
    fc.assert(
      fc.property(
        talkingArbitrary.filter((machine) => messagesOf(machine).length > 0),
        (machine) => {
          expect(layoutMachine(machine)[1]?.overlaps).toEqual([]);
        },
      ),
      { seed: 0x757, numRuns: 300 },
    );
  }, 30_000);
});
