import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import {
  MIN_EDGE_LENGTH,
  NODE_SEPARATION,
  dotGapFor,
  layoutMachine,
  placeMachine,
  pathLength,
  ENTRY_LENGTH,
  LABEL_FOREIGN,
  LABEL_OWN,
  LEG_GAP,
  LEG_INSET,
  LOCK_SLOT,
  LOOP_BASE,
  LOOP_FIRST_SPAN,
  PORT_GAP,
  STUB,
  textWidth,
} from "./layout.ts";
import { LABEL_PAD } from "./geometry.ts";
import type { PlacedState } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { Either } from "@mantaq/utils";
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

describe("placeMachine spacing", () => {
  const placed = placeMachine(tight);

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
    const gaps = placeMachine(tight).edges.map((placed) => placed.dotGap);
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
  const events = ["alpha", "beta", "gamma"];
  const looped = machineOf(
    ["first"],
    events.map((event) => edge({ from: "first", event, target: "first" })),
  );
  const laid = placeMachine(looped);
  const box = laid.nodes[0];
  const top = (box?.y ?? 0) - (box?.height ?? 0) / 2;

  test("loop k is a rectangle: span and bar height follow the formulas", () => {
    const widths = events.map((event) => textWidth(event) + 8 + LOCK_SLOT);
    const spans = [LOOP_FIRST_SPAN];
    const rises = [LOOP_BASE];
    for (const width of widths.slice(0, -1)) {
      spans.push(Math.max((spans.at(-1) ?? 0) + 2 * LEG_GAP, width + 2 * LABEL_FOREIGN));
      rises.push((rises.at(-1) ?? 0) + LABEL_OWN + 16 + LABEL_FOREIGN);
    }
    for (const [index, placed] of laid.edges.entries()) {
      const cx = box?.x ?? 0;
      const span = spans[index] ?? 0;
      const bar = top - (rises[index] ?? 0);
      expect(placed.points).toEqual([
        { x: cx - span / 2, y: top },
        { x: cx - span / 2, y: bar },
        { x: cx + span / 2, y: bar },
        { x: cx + span / 2, y: top },
      ]);
      expect(placed.label.x).toBe(cx);
      expect(placed.label.y).toBe(bar - LABEL_OWN - 8);
    }
  });

  test("the box is as wide as the outer loop plus the inset on both sides", () => {
    const outer = laid.edges.at(-1)?.points;
    const span = (outer?.[3]?.x ?? 0) - (outer?.[0]?.x ?? 0);
    expect(box?.width).toBeGreaterThanOrEqual(span + 2 * LEG_INSET);
  });

  test("the outermost label stays inside the canvas", () => {
    const outer = laid.edges.at(-1);
    expect((outer?.label.y ?? 0) - 8).toBeGreaterThanOrEqual(0);
  });

  test("the 4 loops of workersBusy nest, and none enters workers.working", () => {
    const file = new URL("./reference/team-inbox.json", import.meta.url);
    const machine = JSON.parse(readFileSync(file, "utf8")) as VizMachine;
    const pool = placeMachine(machine);
    const loops = pool.edges.filter(
      (placed) => placed.edge.from === "workersBusy" && placed.edge.to === "workersBusy",
    );
    expect(loops).toHaveLength(4);
    const spans = loops.map((placed) => (placed.points[3]?.x ?? 0) - (placed.points[0]?.x ?? 0));
    for (const [index, span] of spans.slice(1).entries()) {
      expect(span - (spans[index] ?? 0)).toBeGreaterThanOrEqual(2 * LEG_GAP);
    }
    const working = pool.nodes.find((node) => node.id === "workers.working");
    if (working === undefined) throw new Error("no workers.working");
    for (const placed of loops) {
      for (const point of placed.points) {
        const inside =
          Math.abs(point.x - working.x) < working.width / 2 &&
          Math.abs(point.y - working.y) < working.height / 2;
        expect(inside).toBe(false);
      }
    }
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
    const rows = placeMachine(machine).edges.map((placed) => Math.round(placed.label.y));
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
    const layout = placeMachine({ ...machine, states, regions: ["up", "net"] });
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
    const layout = placeMachine({ ...machine, initial: null, states, regions: ["up"] });
    const region = layout.regions[0];
    const entry = layout.entries[0];
    expect((entry?.from.x ?? 0) - 6).toBeGreaterThan((region?.x ?? 0) - (region?.width ?? 0) / 2);
  });

  test("a state that starts the machine and its region gets one entry", () => {
    const machine = machineOf(
      ["up.a", "up.b"],
      [edge({ from: "up.a", event: "go", target: "up.b" })],
    );
    const states = machine.states.map((each) => ({
      ...each,
      region: "up",
      initial: each.id === "up.a",
    }));
    const layout = placeMachine({ ...machine, initial: "up.a", states, regions: ["up"] });
    expect(layout.entries).toHaveLength(1);
  });

  test("a machine without regions has one", () => {
    expect(placeMachine(tight).entries).toHaveLength(1);
  });
});

describe("map-child states", () => {
  const base = machineOf(
    ["first", "photos.sending"],
    [edge({ from: "first", event: "go", target: "photos.sending" })],
  );
  const size = (machine: VizMachine, id: string) => {
    const placed = placeMachine(machine).nodes.find(
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

  test("each state of an actor map has a worker row inside its box, below the name and chips", () => {
    const machine = machineOf(
      ["first", "p.free", "p.working"],
      [edge({ from: "first", event: "go", target: "p.free" })],
    );
    const states = machine.states.map((each) =>
      each.id === "first"
        ? each
        : {
            ...each,
            region: "p",
            effects:
              each.id === "p.working"
                ? [{ name: "run", sends: null } as unknown as VizState["effects"][number]]
                : [],
          },
    );
    const placed = placeMachine({ ...machine, states, regions: ["p"], maps: ["p"] }).nodes;
    const stateOf = (id: string) => {
      const node = placed.find((each) => each.kind === "state" && each.id === id);
      return node?.kind === "state" ? node : undefined;
    };
    expect(stateOf("first")?.workers).toBeUndefined();
    for (const id of ["p.free", "p.working"]) {
      const node = stateOf(id);
      const row = node?.workers;
      if (node === undefined || row === undefined) throw new Error(`no worker row on ${id}`);
      expect(node.width).toBeGreaterThanOrEqual(168);
      expect(row.x - row.width / 2).toBeGreaterThanOrEqual(node.x - node.width / 2 + LABEL_PAD);
      expect(row.x + row.width / 2).toBeLessThanOrEqual(node.x + node.width / 2 - LABEL_PAD);
      expect(row.y + row.height / 2).toBeLessThanOrEqual(node.y + node.height / 2 - LABEL_PAD);
      const above = node.chips.at(-1) ?? node.label;
      expect(row.y - row.height / 2).toBeGreaterThanOrEqual(above.y + above.height / 2 + LABEL_PAD);
      expect(overlapsOf(placeMachine({ ...machine, states, regions: ["p"], maps: ["p"] }))).toEqual(
        [],
      );
    }
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
      placeMachine(
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
  const placed = placeMachine(
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
        placeMachine(
          machineOf(["first", "b"], [edge({ from: "first", event: "go", target: "b" })]),
        ),
      ),
    ).toEqual([]);
  });
});

describe("level runs", () => {
  const four = ["e1", "e2", "e3", "e4"].map((event) => edge({ from: "a", event, target: "b" }));
  const loops = ["l1", "l2"].map((event) => edge({ from: "a", event, target: "a" }));
  const laid = placeMachine(machineOf(["a", "b"], [...four, ...loops]));
  const arrows = laid.edges.filter((placed) => placed.edge.to === "b");

  test("every label sits 9px under the level run of its own arrow", () => {
    expect(arrows).toHaveLength(4);
    for (const placed of arrows) {
      const { x, y, height } = placed.label;
      const run = placed.points.find((point, index) => {
        const next = placed.points[index + 1];
        return next !== undefined && next.y === point.y && point.x <= x && x <= next.x;
      });
      expect(run?.y).toBe(y - height / 2 - 9);
    }
  });

  test("an arrow only slopes between columns: no sloped piece reaches a node or label column", () => {
    const columns = laid.nodes.map((node) => [node.x - node.width / 2, node.x + node.width / 2]);
    for (const placed of arrows) {
      for (const [index, point] of placed.points.entries()) {
        const next = placed.points[index + 1];
        if (next === undefined || next.y === point.y) continue;
        for (const [left, right] of columns) {
          const lo = Math.min(point.x, next.x);
          const hi = Math.max(point.x, next.x);
          expect(hi <= (left ?? 0) || lo >= (right ?? 0)).toBe(true);
        }
      }
    }
  });
});

describe("placeMachine speed", () => {
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
    placeMachine(machineOf(names, edges));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("layoutMachine (what the viewer calls, overlap check included) on the same machine is also well under a second", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const names = ["first", ...Array.from({ length: 19 }, (_, index) => `state${index + 1}`)];
    const edges = Array.from({ length: 55 }, (_, index) => {
      const from = Math.floor(random() * names.length);
      const to = (from + 1 + Math.floor(random() * (names.length - 1))) % names.length;
      return edge({ from: names[from] ?? "", event: `EVENT_${index}`, target: names[to] ?? "" });
    });
    const started = performance.now();
    const laid = layoutMachine(machineOf(names, edges));
    expect(Either.isRight(laid)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  }, 60_000);
});

describe("ports", () => {
  const fan = machineOf(
    ["first", "b", "c", "d"],
    ["b", "c", "d"].map((target) => edge({ from: "first", event: `to${target}`, target })),
  );
  const laid = placeMachine(fan);
  const first = laid.nodes.find((node) => node.id === "first");

  test("ends sit on the box side, PORT_GAP apart, centred on the box middle", () => {
    const starts = laid.edges.map((placed) => placed.points[0]);
    const right = (first?.x ?? 0) + (first?.width ?? 0) / 2;
    for (const point of starts) expect(point?.x).toBe(right);
    const ys = starts.map((point) => point?.y ?? 0).sort((a, b) => a - b);
    expect(ys[1]).toBe(first?.y);
    expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBe(PORT_GAP);
    expect((ys[2] ?? 0) - (ys[1] ?? 0)).toBe(PORT_GAP);
  });

  test("each end leaves the box by a horizontal piece at least STUB long", () => {
    for (const placed of laid.edges) {
      const [port, stub] = placed.points;
      expect(stub?.y).toBe(port?.y);
      expect((stub?.x ?? 0) - (port?.x ?? 0)).toBeGreaterThanOrEqual(STUB);
    }
  });

  test("a box grows to the height its busiest side needs", () => {
    const many = machineOf(
      ["first", "b"],
      ["a", "b", "c", "d", "e", "f"].map((event) => edge({ from: "first", event, target: "b" })),
    );
    const node = placeMachine(many).nodes.find((each) => each.id === "first");
    expect(node?.height).toBe(PORT_GAP * 7);
  });

  test("the entry arrow takes the middle slot of the start state's left side", () => {
    const back = machineOf(
      ["first", "b"],
      [
        edge({ from: "b", event: "x", target: "first" }),
        edge({ from: "b", event: "y", target: "first" }),
      ],
    );
    const placed = placeMachine(back);
    const start = placed.nodes.find((node) => node.id === "first");
    const entry = placed.entries[0];
    expect(entry?.to.x).toBe((start?.x ?? 0) - (start?.width ?? 0) / 2);
    expect((entry?.to.x ?? 0) - (entry?.from.x ?? 0)).toBe(ENTRY_LENGTH);
    const ends = placed.edges.map((each) => each.points.at(-1)?.y ?? 0);
    expect(ends.some((y) => y < (entry?.to.y ?? 0))).toBe(true);
    expect(ends.some((y) => y > (entry?.to.y ?? 0))).toBe(true);
  });
});

describe("region boxes", () => {
  const nothing = { x: 0, y: 0, width: 0, height: 0 };
  function inRegion(): VizMachine {
    const base = machineOf(
      ["a", "r.b", "r.c"],
      [
        edge({ from: "a", event: "go", target: "r.b" }),
        edge({ from: "r.b", event: "go", target: "r.c" }),
      ],
    );
    const states = base.states.map((each) =>
      each.id.startsWith("r.") ? { ...each, region: "r" } : each,
    );
    return { ...base, states, regions: ["r"] };
  }
  const laid = placeMachine(inRegion());
  const region = laid.regions[0];
  const sides = (b: { x: number; y: number; width: number; height: number }) => ({
    left: b.x - b.width / 2,
    right: b.x + b.width / 2,
    top: b.y - b.height / 2,
    bottom: b.y + b.height / 2,
  });

  test("every member is at least LABEL_PAD inside, the title above them", () => {
    const outer = sides(region ?? nothing);
    const title = sides(region?.title ?? nothing);
    for (const id of ["r.b", "r.c"]) {
      const member = sides(laid.nodes.find((each) => each.id === id) ?? nothing);
      expect(member.left - outer.left).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(outer.bottom - member.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(member.top - title.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
    }
    expect(title.top - outer.top).toBe(LABEL_PAD);
    expect(title.left - outer.left).toBe(LABEL_PAD);
  });

  test("a state outside is at least LABEL_PAD from the region", () => {
    const outer = sides(region ?? nothing);
    const a = sides(laid.nodes.find((each) => each.id === "a") ?? nothing);
    expect(outer.left - a.right).toBeGreaterThanOrEqual(LABEL_PAD);
  });

  test("a title wider than the content makes the region title width + 2 * LABEL_PAD wide", () => {
    const long = "r".repeat(40);
    const single = machineOf(["r.b"], []);
    const states = single.states.map((each) => ({ ...each, region: long }));
    const wide = placeMachine({ ...single, states, regions: [long] }).regions[0];
    expect(wide?.width).toBe(textWidth(long) + 8 + 2 * LABEL_PAD);
  });

  test("a nested region sits LABEL_PAD inside its parent, below the parent's title row", () => {
    const base = machineOf(
      ["r.s.a", "r.s.b"],
      [edge({ from: "r.s.a", event: "go", target: "r.s.b" })],
    );
    const states = base.states.map((each) => ({
      ...each,
      region: "r.s",
      initial: each.id === "r.s.a",
    }));
    const placed = placeMachine({ ...base, initial: null, states, regions: ["r", "r.s"] });
    const parentRegion = placed.regions.find((each) => each.region === "r");
    const parent = sides(parentRegion ?? nothing);
    const child = sides(placed.regions.find((each) => each.region === "r.s") ?? nothing);
    const title = sides(parentRegion?.title ?? nothing);
    expect(child.left - parent.left).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(parent.right - child.right).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(parent.bottom - child.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(child.top - title.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
  });
});

describe("space inserted for region titles", () => {
  test("a state beyond a region keeps its distance when a long title widens the region", () => {
    const long = "r".repeat(40);
    const base = machineOf(
      ["first", `${long}.b`, "after"],
      [
        edge({ from: "first", event: "go", target: `${long}.b` }),
        edge({ from: `${long}.b`, event: "out", target: "after" }),
      ],
    );
    const states = base.states.map((each) =>
      each.id.startsWith(long) ? { ...each, region: long, label: "b" } : each,
    );
    const laid = placeMachine({ ...base, states, regions: [long] });
    expect(overlapsOf(laid)).toEqual([]);
    expect(laid.regions[0]?.width).toBe(textWidth(long) + 8 + 2 * LABEL_PAD);
  });
});

describe("state inside", () => {
  const withEffects = (count: number): PlacedState => {
    const base = machineOf(["first"], []);
    const only = base.states[0];
    if (only === undefined) throw new Error("no state");
    only.effects = Array.from({ length: count }, (_, i) => ({ name: `fx${i}`, sends: [] }));
    const placed = placeMachine(base).nodes[0];
    if (placed?.kind !== "state") throw new Error("not a state");
    return placed;
  };

  test("height grows 36, 58, 82, 106 with 0-3 effects", () => {
    expect([0, 1, 2, 3].map((n) => withEffects(n).height)).toEqual([36, 58, 82, 106]);
  });

  test("the name box is 8px above its first chip, and the chips are 8px apart", () => {
    const placed = withEffects(3);
    const [first, second] = placed.chips;
    if (first === undefined || second === undefined) throw new Error("no chips");
    const nameBottom = placed.label.y + placed.label.height / 2;
    expect(first.y - first.height / 2 - nameBottom).toBe(LABEL_PAD);
    expect(second.y - second.height / 2 - (first.y + first.height / 2)).toBe(LABEL_PAD);
    expect(placed.label.y - placed.label.height / 2 - (placed.y - placed.height / 2)).toBe(
      LABEL_PAD,
    );
  });

  test("a state without effects centres its name", () => {
    const placed = withEffects(0);
    expect(placed.label.y).toBe(placed.y);
    expect(placed.label.width).toBe(textWidth("first"));
    expect(placed.chips).toEqual([]);
  });
});
