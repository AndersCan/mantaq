import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { PATH_GAP } from "./geometry.ts";
import { checkedLayout, freeLane, lanePoints, laneOrder, placeMachine } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

function state(id: string): VizState {
  return {
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
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
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
}

function machineOf(ids: string[], edges: VizEdge[]): VizMachine {
  return {
    schemaVersion: VIZ_SCHEMA_VERSION,
    id: "m",
    initial: ids[0] ?? "",
    states: ids.map(state),
    regions: [],
    edges,
    findings: [],
  } as unknown as VizMachine;
}

/** x of every vertical piece of every path, with the edge it belongs to. */
function lanesIn(machine: VizMachine): Array<{ id: string; x: number }> {
  const found: Array<{ id: string; x: number }> = [];
  for (const placed of placeMachine(machine).edges) {
    for (let index = 1; index < placed.points.length; index++) {
      const a = placed.points[index - 1];
      const b = placed.points[index];
      if (a !== undefined && b !== undefined && a.x === b.x && a.y !== b.y)
        found.push({ id: placed.edge.id, x: a.x });
    }
  }
  return found;
}

describe("lanes in a rank gap", () => {
  const steep = machineOf(
    ["a", "b", "c", "d"],
    [
      edge("a", "e1", "d"),
      edge("a", "e2", "d"),
      edge("a", "e3", "d"),
      edge("b", "e4", "d"),
      edge("a", "e5", "b"),
      edge("b", "e6", "c"),
      edge("c", "e7", "d"),
    ],
  );

  test("sloped arrows become level, a vertical lane, level", () => {
    const placed = placeMachine(steep);
    for (const each of placed.edges) {
      for (let index = 1; index < each.points.length; index++) {
        const a = each.points[index - 1];
        const b = each.points[index];
        if (a === undefined || b === undefined) continue;
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
    expect(overlapsOf(placed)).toEqual([]);
  });

  test("lanes of different arrows are at least PATH_GAP apart", () => {
    const lanes = lanesIn(steep).sort((a, b) => a.x - b.x);
    expect(new Set(lanes.map((lane) => lane.id)).size).toBeGreaterThan(1);
    for (let index = 1; index < lanes.length; index++) {
      const previous = lanes[index - 1];
      const next = lanes[index];
      if (previous === undefined || next === undefined || previous.id === next.id) continue;
      if (next.x - previous.x < 1) continue;
      expect(next.x - previous.x).toBeGreaterThanOrEqual(PATH_GAP);
    }
  });

  test("a gap with many sloped arrows widens to hold every lane", () => {
    const events = Array.from({ length: 24 }, (_, index) => index).map((n) =>
      edge("a", `e${n}`, "z"),
    );
    const wide = machineOf(
      ["a", "m", "z"],
      [...events, edge("a", "go", "m"), edge("m", "go", "z"), edge("m", "back", "a")],
    );
    const placed = placeMachine(wide);
    expect(overlapsOf(placed)).toEqual([]);
    const xs = lanesIn(wide).map((lane) => lane.x);
    expect(xs.length).toBeGreaterThanOrEqual(24);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(23 * PATH_GAP);
  });
});

describe("freeLane", () => {
  const title = { x: 100, y: 20, width: 40, height: 16 };

  test("moves a lane that would cross a title row past it", () => {
    expect(freeLane(90, 0, 100, [title])).toBe(100 + 20 + 5);
  });

  test("keeps a lane that is clear of the title in x or in y", () => {
    expect(freeLane(10, 0, 100, [title])).toBe(10);
    expect(freeLane(100, 60, 200, [title])).toBe(100);
    expect(freeLane(100, -100, 0, [title])).toBe(100);
  });

  test("clears two titles side by side whatever order they come in", () => {
    const next = { ...title, x: 140 };
    expect(freeLane(90, 0, 100, [next, title])).toBe(140 + 20 + 5);
  });
});

describe("checkedLayout", () => {
  test("is Right when nothing overlaps", () => {
    const placed = placeMachine(machineOf(["a", "b"], [edge("a", "go", "b")]));
    expect(Either.isRight(checkedLayout(placed))).toBe(true);
  });

  test("is Left with the overlaps when two nodes share a spot", () => {
    const placed = placeMachine(machineOf(["a", "b"], [edge("a", "go", "b")]));
    const [first, second] = placed.nodes;
    if (first === undefined || second === undefined) throw new Error("two nodes");
    const clash = { ...placed, nodes: [first, { ...second, x: first.x, y: first.y }] };
    const checked = checkedLayout(clash);
    expect(Either.isLeft(checked)).toBe(true);
    expect(checked[0]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("an any-state self-loop", () => {
  test("is drawn as a loop above the any-state node, with no overlaps", () => {
    const machine = machineOf(["a", "b"], [edge("a", "go", "b"), edge("*", "tick", "*")]);
    const placed = placeMachine(machine);
    const loop = placed.edges.find((each) => each.edge.from === "*");
    expect(loop?.points.length).toBeGreaterThan(0);
    expect(Either.isRight(checkedLayout(placed))).toBe(true);
  });
});

describe("laneOrder", () => {
  const gap = { start: 626, end: 686 };
  const cross = (id: string, yLeft: number, yRight: number) => ({
    edge: 0,
    from: 1,
    yLeft,
    yRight,
    id,
  });
  const order = (
    crossings: ReturnType<typeof cross>[],
    titles: Parameters<typeof laneOrder>[2] = [],
    level: number[] = [],
  ) =>
    laneOrder({ ...gap, crossings }, level, titles).map(
      (piece) => `${piece.crossing.id} ${piece.yLeft}→${piece.yRight}`,
    );

  test("two arrows that swap rows: the lowest on the cycle jogs through a free row", () => {
    expect(
      order([
        cross("e0", 224.5, 296.5),
        cross("e4", 286, 230.5),
        cross("e5", 162.5, 214.5),
        cross("e6", 105.5, 182.5),
      ]),
    ).toEqual([
      "e6 105.5→182.5",
      "e4 286→258.25",
      "e0 224.5→296.5",
      "e5 162.5→214.5",
      "e4 258.25→230.5",
    ]);
  });

  test("a swapping pair alone", () => {
    expect(order([cross("e0", 40, 144), cross("e4", 148, 50)])).toEqual([
      "e0 40→97",
      "e4 148→50",
      "e0 97→144",
    ]);
  });

  test("no free row between: the jog takes the outer row, the smaller y on a tie", () => {
    expect(order([cross("a", 100, 112), cross("b", 114, 98)])).toEqual([
      "a 100→86",
      "b 114→98",
      "a 86→112",
    ]);
  });

  test("a level piece in the gap blocks its row for the jog", () => {
    expect(order([cross("e0", 40, 144), cross("e4", 148, 50)], [], [97])).toEqual([
      "e0 40→73.5",
      "e4 148→50",
      "e0 73.5→144",
    ]);
  });

  test("a row inside a title's band is skipped for the next free one", () => {
    const title = { x: 656, y: 97, width: 40, height: 16 };
    expect(order([cross("e0", 40, 144), cross("e4", 148, 50)], [title])).toEqual([
      "e0 40→28",
      "e4 148→50",
      "e0 28→144",
    ]);
  });

  test("no cycle: one piece per crossing, in today's order", () => {
    expect(order([cross("a", 100, 100.5), cross("b", 200, 150)])).toEqual([
      "a 100→100.5",
      "b 200→150",
    ]);
  });

  test("a title beside the gap does not block its row", () => {
    const title = { x: 900, y: 97, width: 40, height: 16 };
    expect(order([cross("e0", 40, 144), cross("e4", 148, 50)], [title])[0]).toBe("e0 40→97");
  });

  test("two cycles in one gap jog at rows PATH_GAP apart", () => {
    const pieces = laneOrder(
      {
        ...gap,
        crossings: [
          cross("a", 100, 112),
          cross("b", 114, 98),
          { ...cross("c", 102, 110), edge: 1 },
          { ...cross("d", 116, 96), edge: 1 },
        ],
      },
      [],
      [],
    );
    const jogs = ["a", "c"].flatMap((id) => {
      const own = pieces.filter((piece) => piece.crossing.id === id);
      return own.length === 2 ? [own[0]?.yRight ?? 0] : [];
    });
    expect(jogs.length).toBe(2);
    expect(Math.abs((jogs[0] ?? 0) - (jogs[1] ?? 0))).toBeGreaterThanOrEqual(PATH_GAP);
  });
});

describe("lanePoints", () => {
  const first = { crossing: cross0(), yLeft: 10, yRight: 50 };
  const second = { crossing: cross0(), yLeft: 50, yRight: 90 };
  const lanes = [
    { x: 1, piece: first },
    { x: 2, piece: second },
  ];

  test("rightward walks the pieces left to right, each from its left row", () => {
    expect(lanePoints(lanes, true)).toEqual([
      { x: 1, y: 10 },
      { x: 1, y: 50 },
      { x: 2, y: 50 },
      { x: 2, y: 90 },
    ]);
  });

  test("leftward walks them right to left, each from its right row", () => {
    expect(lanePoints(lanes, false)).toEqual([
      { x: 2, y: 90 },
      { x: 2, y: 50 },
      { x: 1, y: 50 },
      { x: 1, y: 10 },
    ]);
  });
});

function cross0() {
  return { edge: 0, from: 1, yLeft: 0, yRight: 0, id: "e" };
}
