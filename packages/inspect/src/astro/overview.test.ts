import { layoutOverview, machineLinks } from "./overview.ts";
import type { VizMachine } from "@mantaq/viz";
import type { Wire } from "../ast/wires.ts";
import { describe, expect, test } from "vite-plus/test";

function machine(id: string, outputs: string[], inputs: string[], internal: string[] = []) {
  const events = [
    ...inputs.map((name) => ({ id: name, internal: false, doc: null, payload: null })),
    ...internal.map((name) => ({ id: name, internal: true, doc: null, payload: null })),
  ];
  const edges = inputs.map((name) => ({
    id: name,
    from: "idle",
    to: "idle",
    event: name,
    kind: "transition",
  }));
  const value = { id, outputs, events, edges } as unknown as VizMachine;
  return { file: `/x/${id}.ts`, machine: value };
}

describe("machineLinks", () => {
  test("an output another machine handles is a link", () => {
    const links = machineLinks([
      machine("a", ["requestQueued"], []),
      machine("b", [], ["requestQueued"]),
    ]);
    expect(links).toEqual([{ from: "a", to: "b", events: ["requestQueued"], wires: [] }]);
  });

  test("several shared events make one link, sorted", () => {
    const links = machineLinks([machine("a", ["y", "x"], []), machine("b", [], ["x", "y"])]);
    expect(links).toEqual([{ from: "a", to: "b", events: ["x", "y"], wires: [] }]);
  });

  test("two receivers make two links", () => {
    const links = machineLinks([
      machine("c", [], ["x"]),
      machine("a", ["x"], []),
      machine("b", [], ["x"]),
    ]);
    expect(links.map((link) => `${link.from}>${link.to}`)).toEqual(["a>b", "a>c"]);
  });

  test("a machine that handles its own output has no self link", () => {
    expect(machineLinks([machine("a", ["x"], ["x"])])).toEqual([]);
  });

  test("an event the receiver does not handle is no link", () => {
    expect(machineLinks([machine("a", ["x"], []), machine("b", [], [])])).toEqual([]);
  });

  test("an input the receiver declares but no state handles is no link", () => {
    const b = machine("b", [], ["x"]);
    const unhandled = { ...b.machine, edges: [] } as unknown as VizMachine;
    expect(machineLinks([machine("a", ["x"], []), { ...b, machine: unhandled }])).toEqual([]);
  });

  test("an internal event of the receiver is no link", () => {
    expect(machineLinks([machine("a", ["x"], []), machine("b", [], [], ["x"])])).toEqual([]);
  });
});

describe("machineLinks with wires", () => {
  const wire = (to: string, trigger: string, event: string): Wire => ({
    from: "a",
    to,
    trigger,
    event,
    at: "app.ts:3",
  });

  test("a wire alone makes a link", () => {
    const w = wire("b", "change", "poke");
    const links = machineLinks([machine("a", [], []), machine("b", [], ["poke"])], [w]);
    expect(links).toEqual([{ from: "a", to: "b", events: [], wires: [w] }]);
  });

  test("an id match and a wire make one link with both, labelled together", () => {
    const w = wire("b", "change", "poke");
    const machines = [machine("a", ["handedOver"], []), machine("b", [], ["handedOver", "poke"])];
    const links = machineLinks(machines, [w]);
    expect(links).toEqual([{ from: "a", to: "b", events: ["handedOver"], wires: [w] }]);
    const overview = layoutOverview(
      [
        { id: "a", file: "/x/a.ts" },
        { id: "b", file: "/x/b.ts" },
      ],
      links,
    );
    expect(overview.links[0]?.label).toBe("handedOver, change → poke");
    expect(overview.wires).toEqual([w]);
  });

  test("an unheard entry is drawn as one arrow to no box", () => {
    const overview = layoutOverview(
      [{ id: "a", file: "/x/a.ts" }],
      [],
      [],
      [{ id: "a", outputs: ["one", "two"] }],
    );
    expect(overview.boxes).toHaveLength(1);
    expect(overview.unheard).toHaveLength(1);
    expect(overview.unheard[0]?.label).toBe("one, two → nobody");
    expect(overview.unheard[0]?.from).toBe("a");
    expect(overview.unheard[0]?.points.length).toBeGreaterThanOrEqual(2);
  });

  test("each link carries only the wires to its own receiver", () => {
    const toB = wire("b", "change", "poke");
    const toC = wire("c", "output", "ping");
    const links = machineLinks(
      [machine("a", [], []), machine("b", [], ["poke"]), machine("c", [], ["ping"])],
      [toB, toC],
    );
    expect(links).toEqual([
      { from: "a", to: "b", events: [], wires: [toB] },
      { from: "a", to: "c", events: [], wires: [toC] },
    ]);
  });

  test("a wire to an unlisted machine is ignored", () => {
    const links = machineLinks([machine("a", [], [])], [wire("ghost", "change", "poke")]);
    expect(links).toEqual([]);
  });
});

describe("layoutOverview", () => {
  const machines = [
    { id: "a", file: "/x/a.ts" },
    { id: "b", file: "/x/b.ts" },
    { id: "c", file: "/x/c.ts" },
    { id: "lonely", file: "/x/lonely.ts" },
  ];
  const links = [
    { from: "a", to: "b", events: ["x", "y"], wires: [] },
    { from: "b", to: "c", events: ["z"], wires: [] },
  ];

  test("same input gives the same layout", () => {
    expect(layoutOverview(machines, links)).toEqual(layoutOverview(machines, links));
  });

  test("every machine has a box and every link has at least two points", () => {
    const overview = layoutOverview(machines, links);
    expect(overview.boxes.map((box) => box.id)).toEqual(["a", "b", "c", "lonely"]);
    expect(overview.links).toHaveLength(2);
    for (const link of overview.links) expect(link.points.length).toBeGreaterThanOrEqual(2);
    expect(overview.links[0]?.label).toBe("x, y");
  });

  test("a not-run machine gives runs false on its box only, and unknown ids are dropped", () => {
    const sketch = { id: "b", factory: "createBActor", file: "x/b.ts" };
    const ghost = { id: "ghost", factory: "createGhostActor", file: "x/g.ts" };
    const overview = layoutOverview(machines, links, [sketch, ghost]);
    expect(overview.boxes.map((box) => [box.id, box.runs])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
      ["lonely", true],
    ]);
    expect(overview.notRun).toEqual([sketch]);
    expect(layoutOverview(machines, links).notRun).toEqual([]);
  });

  test("boxes do not overlap", () => {
    const { boxes } = layoutOverview(machines, links);
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) {
        const apart =
          p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y;
        expect(apart).toBe(true);
      }
    }
  });
});
