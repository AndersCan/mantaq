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

describe("renderGraph guard condition", () => {
  const analyzed = {
    status: "analyzed",
    location: { file: "a.ts", line: 1, column: 1 },
    registration: "on",
    branches: [
      { conditions: ["ok"], target: { kind: "state", state: "busy" } },
      { conditions: ["!(ok)"], target: { kind: "stay" } },
    ],
    payloadReads: [],
    contextReads: [],
    contextWrites: [],
    readsActorState: false,
    comparisons: [],
    literals: [],
  };
  const guarded = {
    ...machine,
    edges: [
      {
        id: "idle-go-busy",
        from: "idle",
        event: "go",
        to: "busy",
        kind: "transition",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: analyzed,
        doc: null,
        coverage: null,
        tested: null,
      },
    ],
  } as unknown as VizMachine;

  test("the condition is a second line on the arrow and in its aria-label", () => {
    const graph = renderGraph(document, guarded, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    const edge = graph.querySelector('g.edge[data-edge-id="idle-go-busy"]');
    expect(edge?.querySelector(".edge-condition")?.textContent).toBe("ok");
    expect(edge?.querySelector("tspan")?.textContent).toBe("go");
    expect(edge?.getAttribute("aria-label")).toBe("idle on go to busy when ok");
  });
});
