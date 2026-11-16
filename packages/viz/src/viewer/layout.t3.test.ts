import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { LABEL_PAD } from "./geometry.ts";
import { placeMachine, textWidth } from "./layout.ts";
import type { MachineLayout } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string, region: string | null = null): VizState {
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

function machineOf(states: VizState[], edges: VizEdge[], regions: string[]): VizMachine {
  return {
    version: VIZ_SCHEMA_VERSION,
    initial: null,
    states,
    edges,
    events: [],
    maps: [],
    regions,
  } as unknown as VizMachine;
}

const sides = (b: { x: number; y: number; width: number; height: number }) => ({
  left: b.x - b.width / 2,
  right: b.x + b.width / 2,
  top: b.y - b.height / 2,
  bottom: b.y + b.height / 2,
});

describe("region titles have room of their own", () => {
  test("checker: an arrow through a region's title is an overlap", () => {
    const go = edge("A", "go", "B");
    const layout: MachineLayout = {
      width: 400,
      height: 200,
      nodes: [
        {
          kind: "state",
          id: "A",
          state: state("A"),
          x: 100,
          y: 100,
          width: 80,
          height: 36,
          label: { x: 100, y: 100, width: 10, height: 16 },
          chips: [],
        },
        {
          kind: "state",
          id: "B",
          state: state("B"),
          x: 300,
          y: 100,
          width: 80,
          height: 36,
          label: { x: 300, y: 100, width: 10, height: 16 },
          chips: [],
        },
      ],
      edges: [
        {
          edge: go,
          target: "B",
          path: "M140,100 L260,100",
          points: [
            { x: 140, y: 100 },
            { x: 260, y: 100 },
          ],
          label: { x: 200, y: 170, width: 22, height: 16 },
          text: { x: 200, y: 170 },
          dotGap: 6,
        },
      ],
      regions: [
        {
          region: "r",
          x: 200,
          y: 70,
          width: 60,
          height: 100,
          title: { x: 200, y: 100, width: 40, height: 16 },
        },
      ],
      entries: [],
    };
    const titleHits = overlapsOf(layout).filter(
      (each) => each.a === "title:r" || each.b === "title:r",
    );
    expect(titleHits.length).toBeGreaterThan(0);
  });

  test("a long title widens its region and the state beyond moves right with it", () => {
    const long = "r".repeat(80);
    const laid = placeMachine(
      machineOf(
        [{ ...state(`${long}.b`, long), label: "b" }, state("after")],
        [edge(`${long}.b`, "out", "after")],
        [long],
      ),
    );
    const region = sides(laid.regions[0] ?? { x: 0, y: 0, width: 0, height: 0 });
    const after = sides(
      laid.nodes.find((each) => each.id === "after") ?? { x: 0, y: 0, width: 0, height: 0 },
    );
    expect(region.right - region.left).toBe(textWidth(long) + 8 + 2 * LABEL_PAD);
    expect(after.left - region.right).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(overlapsOf(laid)).toEqual([]);
  });

  test("a region at the top keeps the top margin: its title row is inserted, not drawn over the margin", () => {
    const laid = placeMachine(machineOf([state("r.b", "r")], [], ["r"]));
    const region = sides(laid.regions[0] ?? { x: 0, y: 0, width: 0, height: 0 });
    expect(region.top).toBeGreaterThanOrEqual(32);
  });

  test("a region with no members is a title row clear of every state", () => {
    const laid = placeMachine(
      machineOf([state("first"), state("b")], [edge("first", "go", "b")], ["r"]),
    );
    const region = laid.regions[0];
    expect(region?.height).toBe(LABEL_PAD + 16 + LABEL_PAD + LABEL_PAD);
    expect(region?.width).toBe(textWidth("r") + 8 + 2 * LABEL_PAD);
    expect(overlapsOf(laid)).toEqual([]);
  });

  test("a map region's title reads 'one per key' and sets the width", () => {
    const pool = { ...machineOf([state("p.b", "p")], [], ["p"]), maps: ["p"] };
    const region = placeMachine(pool).regions[0];
    expect(region?.width).toBe(textWidth("p: one per key") + 8 + 2 * LABEL_PAD);
  });

  test("checker: a label on a region's title and a state on a region's title are overlaps", () => {
    const layout: MachineLayout = {
      width: 400,
      height: 200,
      nodes: [
        {
          kind: "state",
          id: "A",
          state: state("A"),
          x: 100,
          y: 100,
          width: 80,
          height: 36,
          label: { x: 100, y: 100, width: 10, height: 16 },
          chips: [],
        },
      ],
      edges: [],
      regions: [
        {
          region: "r",
          x: 300,
          y: 100,
          width: 160,
          height: 180,
          title: { x: 300, y: 100, width: 40, height: 16 },
        },
        {
          region: "s",
          x: 100,
          y: 100,
          width: 10,
          height: 10,
          title: { x: 100, y: 100, width: 40, height: 16 },
        },
      ],
      entries: [],
    };
    const hits = overlapsOf(layout).filter((each) => each.b === "title:s" && each.a === "node:A");
    expect(hits.length).toBeGreaterThan(0);
    const go = edge("A", "go", "A");
    const labelled: MachineLayout = {
      ...layout,
      nodes: [],
      edges: [
        {
          edge: go,
          target: "A",
          path: "M10,10 L20,10",
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          label: { x: 300, y: 104, width: 22, height: 16 },
          text: { x: 300, y: 104 },
          dotGap: 6,
        },
      ],
    };
    expect(overlapsOf(labelled).some((each) => each.b === "title:r")).toBe(true);
  });

  test("a loop label wider than its state stays inside the state's region", () => {
    const laid = placeMachine(
      machineOf(
        [state("a"), { ...state("r.b", "r"), initial: true }],
        [edge("a", "go", "r.b"), edge("r.b", "again", "r.b"), edge("r.b", "WWWWWWWWWWWWWW", "r.b")],
        ["r"],
      ),
    );
    expect(overlapsOf(laid)).toEqual([]);
  });

  test("an arrow into a start state's left side leaves by at least ENTRY_STUB, clear of the entry arrow", () => {
    const back = ["e0", "e1", "e2", "e3", "e4"].map((event) => edge("a", event, "first"));
    const laid = placeMachine({
      ...machineOf(
        [{ ...state("first"), initial: true }, state("a"), state("b")],
        [...back, edge("first", "go", "b")],
        [],
      ),
      initial: "first",
    });
    const start = laid.nodes.find((each) => each.id === "first");
    const left = (start?.x ?? 0) - (start?.width ?? 0) / 2;
    const into = laid.edges.filter((each) => each.edge.to === "first");
    expect(into).toHaveLength(5);
    for (const placed of into) {
      const [stub, port] = placed.points.slice(-2);
      expect(port?.x).toBe(left);
      expect((port?.x ?? 0) - (stub?.x ?? 0)).toBeGreaterThanOrEqual(42);
    }
  });

  test("an unknown target of a region member is drawn inside that region", () => {
    const lost: VizEdge = { ...edge("r.b", "lost", "x"), id: "lost", to: null };
    const laid = placeMachine(
      machineOf([state("a"), state("r.b", "r")], [edge("a", "go", "r.b"), lost], ["r"]),
    );
    const region = sides(laid.regions[0] ?? { x: 0, y: 0, width: 0, height: 0 });
    const unknown = sides(
      laid.nodes.find((each) => each.kind === "unknown") ?? { x: 0, y: 0, width: 0, height: 0 },
    );
    expect(unknown.left - region.left).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(region.right - unknown.right).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(unknown.top - region.top).toBeGreaterThanOrEqual(LABEL_PAD);
    expect(region.bottom - unknown.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
  });
});

describe("regions grow past dagre's border on every side without touching neighbours", () => {
  const machine = machineOf(
    [state("a"), { ...state("r.b", "r"), initial: true }, state("r.c", "r"), state("z")],
    [
      edge("a", "go", "r.b"),
      edge("r.b", "one", "r.b"),
      edge("r.b", "two", "r.b"),
      edge("r.b", "next", "r.c"),
      edge("r.c", "out", "z"),
      edge("r.c", "back", "r.b"),
      edge("r.c", "again", "r.c"),
    ],
    ["r"],
  );
  const laid = placeMachine(machine);
  const region = sides(laid.regions[0] ?? { x: 0, y: 0, width: 0, height: 0 });
  const boxOf = (id: string) =>
    sides(laid.nodes.find((each) => each.id === id) ?? { x: 0, y: 0, width: 0, height: 0 });

  test("members sit LABEL_PAD inside on the left, right and bottom, and a title row below the top", () => {
    for (const id of ["r.b", "r.c"]) {
      const node = boxOf(id);
      expect(node.left - region.left).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(region.right - node.right).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(region.bottom - node.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(node.top - region.top).toBeGreaterThanOrEqual(32);
    }
  });

  test("the start state's entry room on its left is inside the region", () => {
    const entry = laid.entries[0];
    expect(entry).toBeDefined();
    expect(Math.min(entry?.from.x ?? 0, entry?.to.x ?? 0)).toBeGreaterThanOrEqual(region.left);
  });

  test("outsiders stay clear of the region", () => {
    const outside = boxOf("a");
    expect(
      outside.right <= region.left - LABEL_PAD || outside.bottom <= region.top - LABEL_PAD,
    ).toBe(true);
    expect(overlapsOf(laid)).toEqual([]);
  });
});

describe("the checker places nodes in the region the layout put them in", () => {
  test("an unknown target inside a region is not a region-edge overlap", () => {
    const lost: VizEdge = { ...edge("r.b", "lost", "x"), id: "lost", to: null };
    const laid = placeMachine(
      machineOf([state("a"), state("r.b", "r")], [edge("a", "go", "r.b"), lost], ["r"]),
    );
    expect(overlapsOf(laid).filter((each) => each.rule === "region-edge")).toEqual([]);
  });

  test("a region's `*` is not a region-edge overlap", () => {
    const laid = placeMachine(
      machineOf(
        [state("a"), state("r.b", "r"), state("r.c", "r")],
        [edge("a", "go", "r.b"), edge("r.*", "reset", "r.c")],
        ["r"],
      ),
    );
    expect(laid.nodes.some((each) => each.kind === "any")).toBe(true);
    expect(overlapsOf(laid).filter((each) => each.rule === "region-edge")).toEqual([]);
  });

  test("an unknown target of a region's `*` is inside that region too", () => {
    const lost: VizEdge = { ...edge("r.*", "lost", "x"), id: "lost", to: null };
    const laid = placeMachine(
      machineOf([state("a"), state("r.b", "r")], [edge("a", "go", "r.b"), lost], ["r"]),
    );
    expect(overlapsOf(laid).filter((each) => each.rule === "region-edge")).toEqual([]);
  });

  test("a start id with no state draws no entry arrow", () => {
    const laid = placeMachine({ ...machineOf([state("a")], [], []), initial: "idle" });
    expect(laid.entries).toEqual([]);
    expect(overlapsOf(laid)).toEqual([]);
  });
});

describe("a region's title row sits above every arrow that runs inside it", () => {
  // Found by fast-check (seed 7) with the route-point member rule removed: e6 runs through the title of map a.b.
  const machine = {
    id: "gen",
    initial: null,
    regions: ["a", "a.b"],
    maps: ["a.b"],
    actors: [],
    states: [
      {
        id: "a.b.VMwde73_",
        label: "a.b.VMwde73_",
        region: "a.b",
        initial: false,
        final: false,
        effects: [],
        coverage: null,
        tested: null,
        doc: null,
      },
      {
        id: "SmWL6Y0CVM",
        label: "SmWL6Y0CVM",
        region: null,
        initial: false,
        final: false,
        effects: [
          {
            name: "Auyydv5iIPFGk0q",
            sends: null,
          },
          {
            name: "pR_G6T_W",
            sends: [],
          },
        ],
        coverage: null,
        tested: null,
        doc: null,
      },
      {
        id: "a.Vv2r0",
        label: "a.Vv2r0",
        region: "a",
        initial: false,
        final: false,
        effects: [
          {
            name: "FcUMwdt8GqmDqMP",
            sends: null,
          },
        ],
        coverage: null,
        tested: null,
        doc: null,
      },
      {
        id: "a.b.2m_43h",
        label: "a.b.2m_43h",
        region: "a.b",
        initial: false,
        final: false,
        effects: [
          {
            name: "wDJ79YUO8PAYr",
            sends: null,
          },
        ],
        coverage: null,
        tested: null,
        doc: null,
      },
    ],
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges: [
      {
        id: "e0",
        from: "SmWL6Y0CVM",
        event: "AAA",
        to: null,
        kind: "transition",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e1",
        from: "a.b.VMwde73_",
        event: "AAA",
        to: "a.b.VMwde73_",
        kind: "stay",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e2",
        from: "a.b.VMwde73_",
        event: "AAA",
        to: "a.b.2m_43h",
        kind: "stay",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e3",
        from: "a.Vv2r0",
        event: "AAA",
        to: "SmWL6Y0CVM",
        kind: "stay",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e4",
        from: "a.Vv2r0",
        event: "AAA",
        to: null,
        kind: "transition",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e5",
        from: "SmWL6Y0CVM",
        event: "AAA",
        to: "a.b.VMwde73_",
        kind: "stay",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
      {
        id: "e6",
        from: "a.b.2m_43h",
        event: "AAA",
        to: "SmWL6Y0CVM",
        kind: "stay",
        origin: "declared",
        emits: [],
        contexts: [],
        explanation: null,
        doc: null,
        coverage: null,
        tested: null,
      },
    ],
    fuzz: null,
    runs: [],
  } as unknown as VizMachine;

  test("an arrow that leaves a map runs below the map's title row", () => {
    const laid = placeMachine(machine);
    expect(overlapsOf(laid).map((overlap) => `${overlap.rule} ${overlap.a} ${overlap.b}`)).toEqual(
      [],
    );
  });
});
