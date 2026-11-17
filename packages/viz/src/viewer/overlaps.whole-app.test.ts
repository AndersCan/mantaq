import machine from "./reference/justus-whole-app.json" with { type: "json" };
import expected from "./reference/justus-whole-app.overlaps.json" with { type: "json" };
import type { VizMachine } from "../schema.ts";
import { placeMachine } from "./layout.ts";
import type { MachineLayout } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import type { Overlap } from "./overlaps.ts";
import { expect, test } from "vite-plus/test";

/** A copy with a few nodes moved onto their neighbours and one route shifted, so the checker has overlaps to find. */
function crowded(layout: MachineLayout): MachineLayout {
  const nodes = layout.nodes.map((node, index) => {
    const target = layout.nodes[index + 1];
    return index % 9 === 3 && target !== undefined
      ? { ...node, x: target.x + 10, y: target.y + 10 }
      : node;
  });
  const edges = layout.edges.map((edge, index) =>
    index % 11 === 5
      ? { ...edge, points: edge.points.map((point) => ({ x: point.x + 25, y: point.y })) }
      : edge,
  );
  return { ...layout, nodes, edges };
}

const layout = placeMachine(machine as unknown as VizMachine);

test("the whole-app board, as drawn, has no overlaps", () => {
  expect(overlapsOf(layout)).toEqual([]);
}, 60_000);

// `reference/justus-whole-app.overlaps.json` is what the checker returned before it skipped far-apart shapes.
test("the whole-app board with nodes and a route moved lists the same overlaps as before", () => {
  expect(overlapsOf(crowded(layout))).toEqual(expected as Overlap[]);
}, 60_000);
