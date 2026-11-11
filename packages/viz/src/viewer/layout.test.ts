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
    maps: [],
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

  test("each self-loop label sits above its own loop, and the feet are apart", () => {
    const machine = machineOf(
      ["first"],
      ["alpha", "beta"].map((event) => edge({ from: "first", event, target: "first" })),
    );
    const edges = layoutMachine(machine).edges;
    for (const placed of edges) {
      const [base, lift] = [...placed.path.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
      const loopTop = (base ?? 0) - 0.75 * ((base ?? 0) - (lift ?? 0));
      expect(placed.label.y + 8).toBeLessThanOrEqual(loopTop);
    }
    const starts = edges.map((placed) => Number(/^M(-?[\d.]+)/.exec(placed.path)?.[1]));
    const ends = edges.map((placed) => Number(/(-?[\d.]+),-?[\d.]+$/.exec(placed.path)?.[1]));
    expect(starts[1]).toBeLessThan(starts[0] ?? 0);
    expect(ends[1]).toBeGreaterThan(ends[0] ?? 0);
  });

  test("the outer loops clear the inner labels, and the arrowheads land apart", () => {
    const events = ["alpha", "beta", "gamma"];
    const machine = machineOf(
      ["first"],
      events.map((event) => edge({ from: "first", event, target: "first" })),
    );
    const laid = layoutMachine(machine);
    const edges = laid.edges;
    const node = laid.nodes[0];
    const curveOf = (path: string) => {
      const [p0, p1, p2, p3] = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      return [p0, p1, p2, p3] as const;
    };
    const at = (u: number, a: number, b: number, c: number, d: number) =>
      (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u ** 2 * c + u ** 3 * d;
    for (let nth = 1; nth < edges.length; nth++) {
      const inner = edges[nth - 1];
      const outer = edges[nth];
      const [p0, p1, p2, p3] = curveOf(outer?.path ?? "");
      const [i0, , , i3] = curveOf(inner?.path ?? "");
      if (!p0 || !p1 || !p2 || !p3 || !i0 || !i3 || !node) throw new Error("bad path");
      // every foot stays on the state's box
      expect(p0.x).toBeGreaterThanOrEqual(node.x - node.width / 2);
      expect(p3.x).toBeLessThanOrEqual(node.x + node.width / 2);
      // arrowheads (6 wide) do not touch on either side
      expect(p3.x - i3.x).toBeGreaterThanOrEqual(6);
      expect(i0.x - p0.x).toBeGreaterThanOrEqual(6);
      // the outer curve, where it passes the inner label's height, is left of the label's text
      const labelWidth = (events[nth - 1]?.length ?? 0) * 7 + 8;
      const labelTop = (inner?.label.y ?? 0) - 8;
      let leftX = Number.NaN;
      for (let step = 0; step <= 400; step++) {
        const u = step / 400;
        if (at(u, p0.y, p1.y, p2.y, p3.y) <= labelTop) {
          leftX = at(u, p0.x, p1.x, p2.x, p3.x);
          break;
        }
      }
      expect(leftX).toBeLessThan((inner?.label.x ?? 0) - labelWidth / 2);
    }
  });

  test("outgoing edges do not shrink the foot spread of the loops", () => {
    const loops = ["alpha", "beta"].map((event) => edge({ from: "first", event, target: "first" }));
    const outgoing = ["x", "y", "z"].map((event, index) =>
      edge({ from: "first", event, target: `t${index}` }),
    );
    const machine = machineOf(["first", "t0", "t1", "t2"], [...loops, ...outgoing]);
    const starts = layoutMachine(machine)
      .edges.filter((placed) => placed.edge.to === placed.edge.from)
      .map((placed) => Number(/^M(-?[\d.]+)/.exec(placed.path)?.[1]));
    expect((starts[0] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(6);
  });

  test("the outermost loop label stays inside the layout", () => {
    const machine = machineOf(
      ["first"],
      ["alpha", "beta", "gamma"].map((event) => edge({ from: "first", event, target: "first" })),
    );
    for (const placed of layoutMachine(machine).edges) {
      expect(placed.label.y - 8).toBeGreaterThanOrEqual(0);
    }
  });

  test("the top margin keeps 64 for one loop and grows for three", () => {
    const topOf = (count: number) => {
      const events = ["alpha", "beta", "gamma"].slice(0, count);
      const machine = machineOf(
        ["first"],
        events.map((event) => edge({ from: "first", event, target: "first" })),
      );
      const node = layoutMachine(machine).nodes[0];
      return (node?.y ?? 0) - (node?.height ?? 0) / 2;
    };
    expect(topOf(0)).toBe(64);
    expect(topOf(1)).toBe(64);
    expect(topOf(3)).toBeGreaterThan(64);
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

  test("a region's start dot stays inside the region's box", () => {
    const machine = machineOf(
      ["up.a", "up.b"],
      [edge({ from: "up.a", event: "go", target: "up.b" })],
    );
    const states = machine.states.map((each) => ({
      ...each,
      region: "up",
      initial: each.id === "up.a",
    }));
    const layout = layoutMachine({ ...machine, initial: null, states, regions: ["up"] });
    const region = layout.regions[0];
    const entry = layout.entries[0];
    expect((entry?.from.x ?? 0) - 6).toBeGreaterThan((region?.x ?? 0) - (region?.width ?? 0) / 2);
  });

  test("a machine without regions has one", () => {
    expect(layoutMachine(tight).entries).toHaveLength(1);
  });
});

describe("map-child states", () => {
  const base = machineOf(
    ["first", "photos.sending"],
    [edge({ from: "first", event: "go", target: "photos.sending" })],
  );
  const size = (machine: VizMachine, id: string) => {
    const placed = layoutMachine(machine).nodes.find(
      (node) => node.kind === "state" && node.id === id,
    );
    return placed?.kind === "state" ? placed : undefined;
  };

  test("reserve a marker row and a minimum width", () => {
    const states = base.states.map((each) =>
      each.id === "first" ? each : { ...each, region: "photos" },
    );
    const map = layoutMachine({ ...base, states, regions: ["photos"], maps: ["photos"] });
    const child = map.nodes.find((node) => node.kind === "state" && node.id === "photos.sending");
    expect(child?.height).toBe(56);
    expect(child?.width).toBeGreaterThanOrEqual(168);
    const root = map.nodes.find((node) => node.kind === "state" && node.id === "first");
    expect(root?.height).toBe(36);
  });

  test("a region that is not a map keeps the plain size", () => {
    const states = base.states.map((each) =>
      each.id === "first" ? each : { ...each, region: "photos" },
    );
    const plain = size({ ...base, states, regions: ["photos"], maps: [] }, "photos.sending");
    expect(plain?.height).toBe(36);
    expect(plain?.width).toBeLessThan(168);
  });
});

describe("two-line edge labels", () => {
  test("guarded parallel edges keep their labels two lines apart", () => {
    const analyzed = {
      status: "analyzed",
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches: [
        { conditions: ["ok"], target: { kind: "state", state: "b" } },
        { conditions: ["!(ok)"], target: { kind: "stay" } },
      ],
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    } as VizEdge["explanation"];
    const pair = (explanation: VizEdge["explanation"]) =>
      layoutMachine(
        machineOf(
          ["first", "b"],
          [
            { ...edge({ from: "first", event: "pay", target: "b" }), explanation },
            { ...edge({ from: "first", event: "pay2", target: "b" }), explanation },
          ],
        ),
      );
    const spread = (layout: ReturnType<typeof pair>) =>
      Math.abs((layout.edges[0]?.label.y ?? 0) - (layout.edges[1]?.label.y ?? 0));
    expect(spread(pair(analyzed))).toBeGreaterThanOrEqual(32);
    expect(spread(pair(null))).toBeLessThan(32);
  });
});
