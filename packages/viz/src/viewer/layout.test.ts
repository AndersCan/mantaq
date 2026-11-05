import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import {
  MIN_EDGE_LENGTH,
  NODE_SEPARATION,
  dotGapFor,
  layoutMachine,
  pathLength,
} from "./layout.ts";
import { describe, expect, test } from "vite-plus/test";

function state(name: string): VizState {
  return {
    id: name,
    label: name,
    region: null,
    initial: name === "first",
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(source: { from: string; event: string; target: string }): VizEdge {
  return {
    id: `${source.from}-${source.event}-${source.target}`,
    from: source.from,
    event: source.event,
    to: source.target,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function machineOf(names: string[], edges: VizEdge[]): VizMachine {
  const first = names[0] ?? "";
  return {
    version: VIZ_SCHEMA_VERSION,
    initial: first,
    states: names.map(state),
    edges,
    events: [],
    regions: [],
  } as unknown as VizMachine;
}

const tight = machineOf(
  ["first", "b", "c", "d"],
  [
    edge({ from: "first", event: "go", target: "b" }),
    edge({ from: "b", event: "go", target: "c" }),
    edge({ from: "first", event: "skip", target: "c" }),
    edge({ from: "c", event: "end", target: "d" }),
  ],
);

function parsePoints(path: string): Array<{ x: number; y: number }> {
  return [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

describe("layoutMachine spacing", () => {
  const placed = layoutMachine(tight);

  test("keeps every edge between two nodes at least the minimum length", () => {
    const nodes = new Map(placed.nodes.map((node) => [node.id, node]));
    for (const { edge: placedEdge, path } of placed.edges) {
      const source = nodes.get(placedEdge.from);
      const target = nodes.get(placedEdge.to ?? "");
      if (source === undefined || target === undefined) continue;
      const gap = Math.abs(target.x - source.x) - (target.width + source.width) / 2;
      expect(gap).toBeGreaterThanOrEqual(MIN_EDGE_LENGTH);
      expect(pathLength(parsePoints(path))).toBeGreaterThanOrEqual(MIN_EDGE_LENGTH);
    }
  });

  test("keeps nodes at least the separation apart", () => {
    for (const first of placed.nodes) {
      for (const second of placed.nodes) {
        if (first.id >= second.id) continue;
        const across = Math.abs(first.x - second.x) - (first.width + second.width) / 2;
        const down = Math.abs(first.y - second.y) - (first.height + second.height) / 2;
        expect(Math.max(across, down) + 1).toBeGreaterThanOrEqual(NODE_SEPARATION);
      }
    }
  });
});

describe("dotGapFor", () => {
  test("grows with edge length", () => {
    expect(dotGapFor(120)).toBe(5);
    expect(dotGapFor(240)).toBe(10);
  });

  test("clamps to the minimum and maximum gap", () => {
    expect(dotGapFor(0)).toBe(3);
    expect(dotGapFor(100000)).toBe(12);
  });

  test("gives every placed edge a gap inside the bounds", () => {
    const gaps = layoutMachine(tight).edges.map((placed) => placed.dotGap);
    expect(gaps.every((gap) => gap >= 3 && gap <= 12)).toBe(true);
  });
});

describe("pathLength", () => {
  test("sums segment lengths", () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
  });

  test("is zero for fewer than two points", () => {
    expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
  });
});
