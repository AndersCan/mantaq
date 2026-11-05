import { describe, expect, it } from "vite-plus/test";
import { availableModes, measure } from "./coverage-mode.ts";
import type { VizMachine } from "../schema.ts";

function machine(coverage: number | null, tested: number | null): VizMachine {
  const hits = (value: number | null) => (value === null ? null : { hits: value });
  return {
    states: [{ coverage: hits(coverage), tested: hits(tested) }],
    edges: [],
  } as unknown as VizMachine;
}

describe("reached coverage mode", () => {
  it("is offered first when both examples and a run have data", () => {
    expect(availableModes(machine(1, 1))).toEqual(["reached", "tests", "run"]);
  });

  it("is not offered with a single source", () => {
    expect(availableModes(machine(1, null))).toEqual(["run"]);
    expect(availableModes(machine(null, 1))).toEqual(["tests"]);
  });

  it("sums example and run hits so either source counts as reached", () => {
    expect(measure("reached", { coverage: { hits: 0 }, tested: { hits: 2 } })).toEqual({ hits: 2 });
    expect(measure("reached", { coverage: { hits: 3 }, tested: { hits: 0 } })).toEqual({ hits: 3 });
    expect(measure("reached", { coverage: { hits: 0 }, tested: { hits: 0 } })).toEqual({ hits: 0 });
    expect(measure("reached", { coverage: null, tested: null })).toBeNull();
  });
});
