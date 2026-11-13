import { describe, expect, test } from "vite-plus/test";
import { asksForPayload } from "./moves.ts";
import type { VizField, VizJson, VizMachine } from "./schema.ts";

/** One event `send`, its declared fields, and the payloads fuzzing sent it. */
function machineWith(fields: VizField[] | null, samples: VizJson[]): VizMachine {
  return {
    id: "m",
    initial: "a",
    regions: [],
    maps: [],
    states: [],
    events: [{ id: "send", internal: false, doc: null, payload: fields }],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: [],
    runs: [],
    fuzz: {
      seed: 1,
      iterations: 1,
      corpus: [
        {
          steps: samples.map((payload) => ({ kind: "event" as const, event: "send", payload })),
          discovered: [],
        },
      ],
      errors: [],
      failedExpectations: [],
      expectations: [],
    },
  };
}

describe("asksForPayload", () => {
  // inspect: `event("tag")<Record<string, string>>()` gives payload [] and fuzz/recorded samples {} only.
  test("a Record payload (declared, no named fields) whose only sample is {} still asks", () => {
    expect(asksForPayload(machineWith([], [{}]), "send")).toBe(true);
  });

  // inspect: `event("ping")<{}>()` gives payload [] too; never sent, nothing to fill.
  test("an empty declared type (payload []) with no samples sends at once", () => {
    expect(asksForPayload(machineWith([], []), "send")).toBe(false);
  });

  test("a no-data event (payload null) whose only sample is {} sends at once", () => {
    expect(asksForPayload(machineWith(null, [{}]), "send")).toBe(false);
  });

  test.each<[string, VizJson]>([
    ["empty array", []],
    ["empty string", ""],
    ["zero", 0],
    ["false", false],
  ])("a sample that is not an object (%s) asks", (_name, sample) => {
    expect(asksForPayload(machineWith(null, [sample]), "send")).toBe(true);
  });
});
