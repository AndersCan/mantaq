import { layoutOverview, machineLinks } from "./overview.ts";
import type { VizMachine } from "@mantaq/viz";
import { describe, expect, test } from "vite-plus/test";

function machine(id: string, outputs: string[], inputs: string[], internal: string[] = []) {
  const events = [
    ...inputs.map((name) => ({ id: name, internal: false, doc: null, payloadType: null })),
    ...internal.map((name) => ({ id: name, internal: true, doc: null, payloadType: null })),
  ];
  const value = { id, outputs, events } as unknown as VizMachine;
  return { file: `/x/${id}.ts`, machine: value };
}

describe("machineLinks", () => {
  test("an output another machine handles is a link", () => {
    const links = machineLinks([
      machine("a", ["requestQueued"], []),
      machine("b", [], ["requestQueued"]),
    ]);
    expect(links).toEqual([{ from: "a", to: "b", events: ["requestQueued"] }]);
  });

  test("several shared events make one link, sorted", () => {
    const links = machineLinks([machine("a", ["y", "x"], []), machine("b", [], ["x", "y"])]);
    expect(links).toEqual([{ from: "a", to: "b", events: ["x", "y"] }]);
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

  test("an internal event of the receiver is no link", () => {
    expect(machineLinks([machine("a", ["x"], []), machine("b", [], [], ["x"])])).toEqual([]);
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
    { from: "a", to: "b", events: ["x", "y"] },
    { from: "b", to: "c", events: ["z"] },
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
