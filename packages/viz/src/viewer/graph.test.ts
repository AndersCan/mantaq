// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "../schema.ts";
import { markExplore } from "./explore.ts";
import { renderGraph } from "./graph.ts";
import { ARROW_SIZE } from "./geometry.ts";
import { LOCK_SLOT, placeMachine, textWidth } from "./layout.ts";

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
  actors: [],
  states: [state("idle", true), state("busy", false)],
  events: [],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: null,
};

describe("renderGraph arrowheads", () => {
  test("both markers draw the same fixed-size head with the tip on the path end", () => {
    const graph = renderGraph(document, machine, {
      select: () => undefined,
    });
    for (const id of ["viz-arrow", "viz-arrow-loop"]) {
      const marker = graph.querySelector(`#${id}`);
      expect(marker?.getAttribute("markerUnits")).toBe("userSpaceOnUse");
      expect(marker?.getAttribute("markerWidth")).toBe(String(ARROW_SIZE));
      expect(marker?.getAttribute("markerHeight")).toBe(String(ARROW_SIZE));
      expect(marker?.getAttribute("refX")).toBe("10");
    }
  });
});

describe("renderGraph width", () => {
  test("floors labels at 0.6rem and caps them at 1.4em", () => {
    const graph = renderGraph(document, machine, {
      select: () => undefined,
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
    });
    const edge = graph.querySelector('g.edge[data-edge-id="idle-go-busy"]');
    expect(edge?.querySelector(".edge-condition")?.textContent).toBe("ok");
    expect(edge?.querySelector("tspan")?.textContent).toBe("go");
    expect(edge?.getAttribute("aria-label")).toBe("idle on go to busy when ok");
  });
});

describe("renderGraph transition label", () => {
  const go: VizMachine = {
    ...machine,
    edges: [
      {
        id: "idle-submitWWW-busy",
        from: "idle",
        event: "submitWWW",
        to: "busy",
        kind: "transition",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
    ],
  };

  test("draws the text right of the lock slot and the lock inside it", () => {
    const root = document.createElement("div");
    root.append(
      renderGraph(document, go, {
        select: () => undefined,
      }),
    );
    const placed = placeMachine(go).edges[0];
    const text = root.querySelector('[data-edge-id="idle-submitWWW-busy"] text');
    expect(Number(text?.getAttribute("x"))).toBe(placed?.text.x);
    const spans = [...(text?.querySelectorAll("tspan") ?? [])];
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(Number(span.getAttribute("x"))).toBe(placed?.text.x);
    expect(Number(text?.getAttribute("y"))).toBe((placed?.text.y ?? 0) + 4);
    expect(placed?.text.x).toBe((placed?.label.x ?? 0) + LOCK_SLOT / 2);
    markExplore(root, { machine: go, path: [], blocked: new Map([["idle-submitWWW-busy", "no"]]) });
    const lock = Number(root.querySelector(".blocked-lock rect")?.getAttribute("x"));
    const textLeft = (placed?.text.x ?? 0) - textWidth("submitWWW") / 2;
    const boxLeft = (placed?.label.x ?? 0) - (placed?.label.width ?? 0) / 2;
    expect(lock).toBeGreaterThanOrEqual(boxLeft);
    expect(lock + 8 + 4).toBeLessThanOrEqual(textLeft);
  });
});

describe("renderGraph region title", () => {
  test("starts inside the region's left edge so live text of any length stays anchored there", () => {
    const pooled: VizMachine = {
      ...machine,
      regions: ["workers"],
      maps: ["workers"],
      states: [{ ...state("workers.working", true), region: "workers" }],
    };
    const graph = renderGraph(document, pooled, {
      select: () => undefined,
    });
    const rect = graph.querySelector("g.region > rect");
    const text = graph.querySelector("g.region > text");
    const left = Number(rect?.getAttribute("x"));
    expect(Number(text?.getAttribute("x"))).toBe(left + 12);
    expect(text?.getAttribute("text-anchor")).toBeNull();
  });
});

describe("renderGraph state inside", () => {
  test("the name and each chip are drawn from the layout's boxes", () => {
    const busy = { ...state("busy", false), effects: [{ name: "ping", sends: [] }] };
    const withChips: VizMachine = { ...machine, states: [state("idle", true), busy] };
    const graph = renderGraph(document, withChips, {
      select: () => undefined,
    });
    const placed = placeMachine(withChips).nodes.find((node) => node.id === "busy");
    if (placed?.kind !== "state") throw new Error("not a state");
    const group = graph.querySelector('[data-node-id="busy"]');
    expect(group?.querySelector(":scope > text")?.getAttribute("y")).toBe(
      String(placed.label.y + 4),
    );
    const chip = placed.chips[0];
    const rect = group?.querySelector(".chip rect");
    expect(rect?.getAttribute("y")).toBe(String((chip?.y ?? 0) - (chip?.height ?? 0) / 2));
    expect(rect?.getAttribute("width")).toBe(String(chip?.width));
    expect(rect?.getAttribute("height")).toBe(String(chip?.height));
  });
});

describe("renderGraph state inside: every drawn position comes from the boxes", () => {
  test("name x, chip rect x and chip text sit on the layout's boxes", () => {
    const busy = {
      ...state("busy", false),
      effects: [
        { name: "ping", sends: [] },
        { name: "pong", sends: null },
      ],
    };
    const withChips: VizMachine = { ...machine, states: [state("idle", true), busy] };
    const graph = renderGraph(document, withChips, {
      select: () => undefined,
    });
    const placed = placeMachine(withChips).nodes.find((node) => node.id === "busy");
    if (placed?.kind !== "state") throw new Error("not a state");
    const group = graph.querySelector('[data-node-id="busy"]');
    expect(group?.querySelector(":scope > text")?.getAttribute("x")).toBe(String(placed.label.x));
    const chips = [...(group?.querySelectorAll(".chip") ?? [])];
    expect(chips).toHaveLength(2);
    for (const [index, chip] of chips.entries()) {
      const box = placed.chips[index];
      if (box === undefined) throw new Error("no box");
      const rect = chip.querySelector("rect");
      expect(rect?.getAttribute("x")).toBe(String(box.x - box.width / 2));
      const text = chip.querySelector("text");
      expect(text?.getAttribute("x")).toBe(String(box.x));
      expect(text?.getAttribute("y")).toBe(String(box.y + 4));
    }
  });
});

describe("renderGraph worker row", () => {
  test("a state of an actor map draws a hidden rect.worker-row on its box; other states none", () => {
    const pooled: VizMachine = {
      ...machine,
      regions: ["p"],
      maps: ["p"],
      states: [state("idle", true), { ...state("p.free", false), region: "p" }],
    };
    const graph = renderGraph(document, pooled, {
      select: () => undefined,
    });
    const placed = placeMachine(pooled).nodes.find((node) => node.id === "p.free");
    if (placed?.kind !== "state" || placed.workers === undefined) throw new Error("no row");
    const row = graph.querySelector('[data-node-id="p.free"] > rect.worker-row');
    expect(row?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.getAttribute("x")).toBe(String(placed.workers.x - placed.workers.width / 2));
    expect(row?.getAttribute("y")).toBe(String(placed.workers.y - placed.workers.height / 2));
    expect(row?.getAttribute("width")).toBe(String(placed.workers.width));
    expect(row?.getAttribute("height")).toBe(String(placed.workers.height));
    expect(graph.querySelector('[data-node-id="idle"] rect.worker-row')).toBeNull();
  });
});
