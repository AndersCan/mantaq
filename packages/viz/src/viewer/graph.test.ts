// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "../schema.ts";
import { renderGraph } from "./graph.ts";

function state(id: string, initial: boolean): VizState {
  return {
    id,
    label: id,
    region: null,
    initial,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

const machine: VizMachine = {
  id: "toggle",
  initial: "idle",
  regions: [],
  maps: [],
  states: [state("idle", true), state("busy", false)],
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: null,
};

describe("renderGraph width", () => {
  test("floors labels at 0.6rem and caps them at 1.4em", () => {
    const graph = renderGraph(document, machine, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    const match = /^width: clamp\(([\d.]+)rem, 100%, ([\d.]+)em\)$/.exec(
      graph.getAttribute("style") ?? "",
    );
    const units = Number(graph.getAttribute("viewBox")?.split(" ")[2]);
    expect(Number(match?.[1])).toBeCloseTo((units * 0.6) / 12, 0);
    expect(Number(match?.[2])).toBeCloseTo((units * 1.4) / 12, 0);
  });
});
