import type { VizState } from "../schema.ts";
import type { MachineLayout, PlacedEdge, PlacedState } from "./layout.ts";
import { overlapsOf, pathPoints } from "./overlaps.ts";
import { expect, test } from "vite-plus/test";

function node(id: string, x: number, y = 100): PlacedState {
  const state: VizState = {
    id,
    label: id,
    region: null,
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
  return {
    kind: "state",
    id,
    state,
    x,
    y,
    width: 80,
    height: 36,
    label: { x, y, width: 10, height: 16 },
    chips: [],
  };
}

const edge: PlacedEdge = {
  edge: {
    id: "e",
    from: "A",
    event: "go",
    to: "C",
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  },
  target: "C",
  path: "M100,118 L100,160 L200,160",
  points: pathPoints("M100,118 L100,160 L200,160"),
  label: { x: 200, y: 100, width: 22, height: 16 },
  text: { x: 200, y: 100 },
  dotGap: 6,
};

function layoutWith(message: string): MachineLayout {
  return {
    width: 400,
    height: 200,
    nodes: [node("A", 100), node("B", 300), node("C", 240, 160)],
    edges: [edge],
    messages: [{ from: "A", to: "B", path: message, points: pathPoints(message), dotGap: 6 }],
    regions: [],
    entries: [],
  };
}

test("the checker holds a message line like an arrow: another arrow's label must clear it", () => {
  expect(overlapsOf(layoutWith("M140,40 L300,40 L300,82"))).toEqual([]);
  expect(overlapsOf(layoutWith("M140,100 L260,100"))).toEqual([
    { rule: "label-clear", a: "label:e", b: "path:message:A>B", gap: 0 },
  ]);
});
