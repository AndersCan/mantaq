import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import {
  MIN_EDGE_LENGTH,
  NODE_SEPARATION,
  dotGapFor,
  layoutMachine,
  pathLength,
  LOCK_SLOT,
  labelSpots,
  textWidth,
} from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";

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

describe("textWidth", () => {
  test("measures wide letters at their real width", () => {
    expect(textWidth("WWWWWWWWWW")).toBeGreaterThanOrEqual(113);
    expect(textWidth("team.WORKERS_RESIZED")).toBeGreaterThanOrEqual(151);
  });

  test("scales with the font size and is zero for no text", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("abc", 24)).toBe(textWidth("abc") * 2);
  });

  test("an unlisted character counts as 15px", () => {
    expect(textWidth("é")).toBe(Math.ceil(15 * 1.05));
  });
});

describe("self-loops", () => {
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
  test("guarded parallel edges get a box two lines tall and stay clear of each other", () => {
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
    const layout = pair(analyzed);
    expect(layout.edges.map((placed) => placed.label.height)).toEqual([32, 32]);
    expect(overlapsOf(layout)).toEqual([]);
    expect(pair(null).edges.map((placed) => placed.label.height)).toEqual([16, 16]);
  });
});

describe("edge label boxes", () => {
  const stay: VizEdge = { ...edge({ from: "first", event: "ping", target: "b" }), kind: "stay" };
  const placed = layoutMachine(
    machineOf(
      ["first", "b"],
      [edge({ from: "first", event: "team.WORKERS_RESIZED", target: "b" }), stay],
    ),
  ).edges;

  test("a transition's box is its text width plus padding plus the lock slot", () => {
    const box = placed[0]?.label;
    expect(box?.width).toBe(textWidth("team.WORKERS_RESIZED") + 8 + LOCK_SLOT);
    expect(box?.height).toBe(16);
  });

  test("the text is centred right of the box centre by half the lock slot, only for transitions", () => {
    expect((placed[0]?.text.x ?? 0) - (placed[0]?.label.x ?? 0)).toBe(LOCK_SLOT / 2);
    expect(placed[1]?.text.x).toBe(placed[1]?.label.x);
    expect(placed[1]?.label.width).toBe(textWidth("ping") + 8);
  });

  test("a label sits beside its own arrow, not on it", () => {
    expect(
      overlapsOf(
        layoutMachine(
          machineOf(["first", "b"], [edge({ from: "first", event: "go", target: "b" })]),
        ),
      ),
    ).toEqual([]);
  });
});

describe("labelSpots", () => {
  const placed = layoutMachine(
    machineOf(["first", "b"], [edge({ from: "first", event: "go", target: "b" })]),
  ).edges[0];
  const bent = [
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ];

  test("starts at dagre's spot, then its mirror above the arrow", () => {
    const { x, y, height } = placed?.label ?? { x: 0, y: 0, height: 0 };
    const spots = placed === undefined ? [] : labelSpots(placed, bent);
    expect(spots.slice(0, 2)).toEqual([
      { x, y },
      { x, y: y - 2 * (height / 2 + 8) },
    ]);
  });

  test("then offers a spot below and one above the arrow, nearest its middle first", () => {
    const spots = placed === undefined ? [] : labelSpots(placed, bent);
    const half = (placed?.label.height ?? 0) / 2;
    expect(spots.slice(2, 4)).toEqual([
      { x: 100, y: 100 + half + 9 },
      { x: 100, y: 100 - half - 9 },
    ]);
  });
});

describe("labelSpots geometry", () => {
  const placed = layoutMachine(
    machineOf(["first", "b"], [edge({ from: "first", event: "go", target: "b" })]),
  ).edges[0];
  const width = placed?.label.width ?? 0;
  const half = (placed?.label.height ?? 0) / 2;

  test("measures the arrow only under the label, not along the whole segment", () => {
    const long = [
      { x: 0, y: 100 },
      { x: 1000, y: 1100 },
    ];
    const spots = placed === undefined ? [] : labelSpots(placed, long);
    expect(spots[2]).toEqual({ x: 500, y: 600 + width / 2 + half + 1 + 8 * Math.SQRT2 });
  });

  test("a steep arrow pushes the label away by at most a slope of 3", () => {
    const steep = [
      { x: 0, y: 0 },
      { x: 10, y: 1000 },
    ];
    const spots = placed === undefined ? [] : labelSpots(placed, steep);
    const clipped = (5 + width / 2 > 10 ? 10 : 5 + width / 2) * 100;
    const top = (5 - width / 2 < 0 ? 0 : 5 - width / 2) * 100;
    expect(spots[2]?.y).toBeCloseTo(clipped + half + 1 + 8 * Math.hypot(1, 3));
    expect(spots[3]?.y).toBeCloseTo(top - half - 1 - 8 * Math.hypot(1, 3));
  });

  test("dagre puts the label below its arrow, 8px clear", () => {
    const y = Number(placed?.path.split(/[ ,MCL]+/).filter(Boolean)[1]);
    expect((placed?.label.y ?? 0) - half - y).toBe(8);
  });
});

describe("layoutMachine speed", () => {
  test("a 20-state, 55-arrow machine lays out in well under a second (it runs on every click)", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const names = ["first", ...Array.from({ length: 19 }, (_, index) => `state${index + 1}`)];
    const edges = Array.from({ length: 55 }, (_, index) => {
      const from = Math.floor(random() * names.length);
      const to = (from + 1 + Math.floor(random() * (names.length - 1))) % names.length;
      return edge({ from: names[from] ?? "", event: `EVENT_${index}`, target: names[to] ?? "" });
    });
    const started = performance.now();
    layoutMachine(machineOf(names, edges));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("settleLabels and self-loops", () => {
  test("a self-loop label stays just above its apex even when it touches a settled label", () => {
    const file = new URL("./reference/team-inbox.json", import.meta.url);
    const machine = JSON.parse(readFileSync(file, "utf8")) as VizMachine;
    const loops = layoutMachine(machine).edges.filter(
      (placed) => placed.edge.from === placed.edge.to,
    );
    expect(loops.length).toBeGreaterThan(0);
    for (const placed of loops) {
      const [base, lift] = [...placed.path.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
      const apex = (base ?? 0) - 0.75 * ((base ?? 0) - (lift ?? 0));
      expect(placed.label.y).toBeCloseTo(apex - 16 / 2 - 2, 0);
    }
  });
});
