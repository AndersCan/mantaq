import type { VizEdge, VizState } from "../schema.ts";
import type { MachineLayout, PlacedEdge, PlacedState } from "./layout.ts";
import { overlapsOf, pathPoints } from "./overlaps.ts";
import type { Overlap, Rule } from "./overlaps.ts";
import { describe, expect, test } from "vite-plus/test";

function vizState(id: string, region: string | null): VizState {
  return {
    id,
    label: id,
    region,
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function node(id: string, x: number, region: string | null = null): PlacedState {
  return { kind: "state", id, state: vizState(id, region), x, y: 100, width: 80, height: 36 };
}

function placedEdge(
  id: string,
  path: string,
  label: { x: number; y: number },
  to = "B",
): PlacedEdge {
  const edge: VizEdge = {
    id,
    from: "A",
    event: "go",
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
  return { edge, target: to, path, label, dotGap: 6 };
}

const straight = "M140,100 L260,100";

function layoutOf(parts: Partial<MachineLayout>): MachineLayout {
  return {
    width: 400,
    height: 200,
    nodes: [node("A", 100), node("B", 300)],
    edges: [],
    regions: [],
    entries: [],
    ...parts,
  };
}

function ofRule(layout: MachineLayout, rule: Rule): Overlap[] {
  return overlapsOf(layout).filter((overlap) => overlap.rule === rule);
}

const labelAt = (x: number, y: number) => ({ x, y });

describe("overlapsOf", () => {
  test("a clean layout has no overlaps, and a path may touch its own end nodes", () => {
    const layout = layoutOf({ edges: [placedEdge("e", straight, labelAt(200, 60))] });
    expect(overlapsOf(layout)).toEqual([]);
  });

  test("label-clear: a label on its own arrow", () => {
    const layout = layoutOf({ edges: [placedEdge("e", straight, labelAt(200, 100))] });
    expect(overlapsOf(layout)).toEqual([
      { rule: "label-clear", a: "label:e", b: "path:e", gap: 0 },
    ]);
  });

  test("label-clear: 8px between two labels passes, 7px fails", () => {
    const two = (x: number) =>
      layoutOf({
        edges: [
          placedEdge("e", straight, labelAt(200, 60)),
          placedEdge("f", "M140,160 L260,160", labelAt(x, 60)),
        ],
      });
    expect(overlapsOf(two(230))).toEqual([]);
    expect(overlapsOf(two(229))).toEqual([
      { rule: "label-clear", a: "label:e", b: "label:f", gap: 7 },
    ]);
  });

  test("label-clear: a label touching a state box", () => {
    const layout = layoutOf({
      nodes: [node("A", 100), node("B", 300), node("C", 200)],
      edges: [placedEdge("e", straight, labelAt(200, 68))],
    });
    expect(ofRule(layout, "label-clear")).toEqual([
      { rule: "label-clear", a: "label:e", b: "node:C", gap: 0 },
    ]);
  });

  test("path-through-node: a path through a state it does not end at", () => {
    const layout = layoutOf({
      nodes: [node("A", 100), node("B", 300), node("C", 200)],
      edges: [placedEdge("e", straight, labelAt(200, 40))],
    });
    expect(ofRule(layout, "path-through-node")).toEqual([
      { rule: "path-through-node", a: "path:e", b: "node:C", gap: 0 },
    ]);
  });

  test("paths-alongside: 2px apart fails, 6px apart passes", () => {
    const two = (y: number) =>
      layoutOf({
        edges: [
          placedEdge("e", straight, labelAt(200, 60)),
          placedEdge("f", `M140,${y} L260,${y}`, labelAt(200, 20)),
        ],
      });
    expect(ofRule(two(102), "paths-alongside")).toEqual([
      { rule: "paths-alongside", a: "path:e", b: "path:f", gap: 0 },
    ]);
    expect(ofRule(two(106), "paths-alongside")).toEqual([]);
  });

  test("arrowheads: two arrowheads sharing a spot", () => {
    const two = (y: number) =>
      layoutOf({
        edges: [
          placedEdge("e", straight, labelAt(200, 60)),
          placedEdge("f", `M140,${y} L260,${y}`, labelAt(200, 20)),
        ],
      });
    expect(ofRule(two(104), "arrowheads")).toEqual([
      { rule: "arrowheads", a: "arrow:e", b: "arrow:f", gap: -4 },
    ]);
    expect(ofRule(two(110), "arrowheads")).toEqual([]);
  });

  test("nodes: 8px between states passes, 7px fails", () => {
    const at = (x: number) => layoutOf({ nodes: [node("A", 100), node("B", x)] });
    expect(overlapsOf(at(194))).toEqual([]);
    expect(overlapsOf(at(193))).toEqual([{ rule: "nodes", a: "node:A", b: "node:B", gap: 7 }]);
  });

  test("region-edge: a state 8px inside its region passes, 7px fails", () => {
    const around = (width: number) =>
      layoutOf({
        nodes: [node("A", 100, "r"), node("B", 300)],
        regions: [{ region: "r", x: 100, y: 100, width, height: 64 }],
      });
    expect(overlapsOf(around(108))).toEqual([]);
    expect(overlapsOf(around(106))).toEqual([
      { rule: "region-edge", a: "node:A", b: "region:r", gap: 7 },
    ]);
  });

  test("region-edge: a state inside a region it does not belong to, or 7px from its border, fails", () => {
    const beside = (x: number) =>
      layoutOf({ regions: [{ region: "r", x, y: 100, width: 100, height: 100 }] });
    expect(ofRule(beside(300), "region-edge")).toEqual([
      { rule: "region-edge", a: "node:B", b: "region:r", gap: -68 },
    ]);
    expect(ofRule(beside(404), "region-edge")).toEqual([]);
    expect(ofRule(beside(403), "region-edge")).toEqual([
      { rule: "region-edge", a: "node:B", b: "region:r", gap: 7 },
    ]);
  });

  test("outside: a label past the canvas edge", () => {
    const layout = (x: number) => layoutOf({ edges: [placedEdge("e", straight, labelAt(x, 60))] });
    expect(overlapsOf(layout(380))).toEqual([]);
    expect(overlapsOf(layout(395))).toEqual([
      { rule: "outside", a: "label:e", b: "canvas", gap: -6 },
    ]);
  });

  test("label-clear: a label 6px from another edge's arrowhead", () => {
    const layout = layoutOf({
      edges: [
        placedEdge("g", "M140,160 L260,160", labelAt(150, 140)),
        placedEdge("f", "M140,30 L260,30", labelAt(256, 142)),
      ],
    });
    expect(ofRule(layout, "label-clear")).toEqual([
      { rule: "label-clear", a: "label:f", b: "arrow:g", gap: 6 },
    ]);
  });

  test("label-clear: a label 6px from an entry arrow, or on a region border", () => {
    const entry = { from: { x: 20, y: 100 }, to: { x: 57, y: 100 } };
    const nearEntry = layoutOf({
      entries: [entry],
      edges: [placedEdge("e", straight, labelAt(30, 86))],
    });
    expect(ofRule(nearEntry, "label-clear")).toEqual([
      { rule: "label-clear", a: "label:e", b: "entry:0", gap: 6 },
    ]);
    const onBorder = layoutOf({
      regions: [{ region: "r", x: 100, y: 100, width: 108, height: 64 }],
      edges: [placedEdge("e", straight, labelAt(100, 60))],
    });
    expect(ofRule(onBorder, "label-clear")).toEqual([
      { rule: "label-clear", a: "label:e", b: "region:r", gap: 0 },
    ]);
  });

  test("path-through-node: a path 2px from an entry arrow", () => {
    const layout = layoutOf({
      entries: [{ from: { x: 20, y: 100 }, to: { x: 57, y: 100 } }],
      edges: [placedEdge("e", "M20,102 L260,102", labelAt(200, 60))],
    });
    expect(ofRule(layout, "path-through-node")).toEqual([
      { rule: "path-through-node", a: "path:e", b: "entry:0", gap: 2 },
    ]);
  });

  test("outside: a state past the canvas edge", () => {
    const layout = layoutOf({ nodes: [node("A", 100), node("B", 380)] });
    expect(ofRule(layout, "outside")).toEqual([
      { rule: "outside", a: "node:B", b: "canvas", gap: -26 },
    ]);
  });

  test("overlaps come sorted by rule, then parts", () => {
    const layout = layoutOf({
      nodes: [node("A", 100), node("B", 193)],
      edges: [placedEdge("e", straight, labelAt(200, 100))],
    });
    const rules = overlapsOf(layout).map((overlap) => overlap.rule);
    expect(rules).toEqual([...rules].sort());
    expect(rules).toContain("nodes");
    expect(rules).toContain("label-clear");
  });
});

describe("pathPoints", () => {
  test("reads lines with negative coordinates", () => {
    expect(pathPoints("M-1.5,2 L3,-4")).toEqual([
      { x: -1.5, y: 2 },
      { x: 3, y: -4 },
    ]);
  });

  test("samples a Bézier at t steps of 0.02, ending on its last point", () => {
    const points = pathPoints("M0,0 C0,10 10,10 10,0");
    expect(points).toHaveLength(51);
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
    expect(points[25]).toEqual({ x: 5, y: 7.5 });
  });
});
