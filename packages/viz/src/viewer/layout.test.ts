import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import {
  MIN_EDGE_LENGTH,
  NODE_SEPARATION,
  dotGapFor,
  layoutMachine,
  pathLength,
  separateLabels,
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

describe("separateLabels", () => {
  const size = { width: 60, height: 16 };

  test("moves stacked labels apart and keeps a free label in place", () => {
    const out = separateLabels([
      { x: 0, y: 0, ...size },
      { x: 5, y: 3, ...size },
      { x: 2, y: -2, ...size },
      { x: 500, y: 0, ...size },
    ]);
    expect(out[0]?.y).toBe(0);
    expect(out[3]).toEqual({ x: 500, y: 0, ...size });
    const ys = new Set(out.slice(0, 3).map((box) => box.y));
    expect(ys.size).toBe(3);
    for (const a of out.slice(0, 3)) {
      for (const b of out.slice(0, 3)) {
        if (a !== b) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(16);
      }
    }
  });

  test("searches 0, +1, -1, +2 rows with a 2px gap", () => {
    const out = separateLabels([
      { x: 0, y: 100, ...size },
      { x: 0, y: 100, ...size },
      { x: 0, y: 100, ...size },
      { x: 0, y: 100, ...size },
    ]);
    expect(out.map((box) => box.y)).toEqual([100, 118, 82, 136]);
  });

  test("keeps a label that only just clears the gap", () => {
    const out = separateLabels([
      { x: 0, y: 0, ...size },
      { x: 0, y: 18, ...size },
      { x: 0, y: 17, ...size },
    ]);
    expect(out[1]?.y).toBe(18);
    expect(out[2]?.y).toBe(53);
  });

  test("does not move labels that are close in y but far apart in x", () => {
    const out = separateLabels([
      { x: 0, y: 0, ...size },
      { x: 200, y: 4, ...size },
    ]);
    expect(out.map((box) => box.y)).toEqual([0, 4]);
  });

  test("keeps order and count", () => {
    const input = [3, 1, 2].map((x) => ({ x, y: 0, ...size }));
    expect(separateLabels(input).map((box) => box.x)).toEqual([3, 1, 2]);
    expect(separateLabels([])).toEqual([]);
  });

  test("labels of two self-loops on one node do not overlap", () => {
    const machine = machineOf(
      ["first"],
      [
        edge({ from: "first", event: "alpha", target: "first" }),
        edge({ from: "first", event: "beta", target: "first" }),
      ],
    );
    const [a, b] = layoutMachine(machine).edges;
    expect(Math.abs((a?.label.y ?? 0) - (b?.label.y ?? 0))).toBeGreaterThanOrEqual(18);
  });

  test("labels of parallel edges get distinct rows", () => {
    const machine = machineOf(
      ["first", "b"],
      [
        edge({ from: "first", event: "alpha", target: "b" }),
        edge({ from: "first", event: "beta", target: "b" }),
        edge({ from: "first", event: "gamma", target: "b" }),
      ],
    );
    const rows = layoutMachine(machine).edges.map((placed) => Math.round(placed.label.y));
    expect(new Set(rows).size).toBe(3);
  });
});

describe("entry arrows", () => {
  test("the machine and each region with a start state get one", () => {
    const machine = machineOf(
      ["first", "up.a", "up.b", "net.on"],
      [edge({ from: "up.a", event: "go", target: "up.b" })],
    );
    const states = machine.states.map((each) =>
      each.id.includes(".")
        ? { ...each, region: each.id.slice(0, each.id.indexOf(".")), initial: each.id !== "up.b" }
        : each,
    );
    const layout = layoutMachine({ ...machine, states, regions: ["up", "net"] });
    expect(layout.entries).toHaveLength(3);
  });

  test("a machine without regions has one", () => {
    expect(layoutMachine(tight).entries).toHaveLength(1);
  });
});
