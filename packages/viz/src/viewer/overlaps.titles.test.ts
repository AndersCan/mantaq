import type { VizEdge, VizState } from "../schema.ts";
import type { MachineLayout } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { describe, expect, test } from "vite-plus/test";

const state = (id: string): VizState => ({
  id,
  label: id,
  region: null,
  initial: false,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});
const go: VizEdge = {
  id: "A-go-B",
  from: "A",
  event: "go",
  to: "B",
  kind: "transition",
  origin: "declared",
  emits: [],
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
};

const titleHits = (layout: MachineLayout) =>
  overlapsOf(layout).filter(
    (each) => each.rule === "path-through-node" && (each.a === "title:r" || each.b === "title:r"),
  );

describe("checker: region titles against arrowheads and entry arrows", () => {
  test("an arrowhead on a region's title is an overlap even when the line stays clear", () => {
    // line y=100 ends at x=270: 6px above the title (clear), arrowhead box reaches y=104 (2px gap)
    const layout: MachineLayout = {
      width: 500,
      height: 240,
      messages: [],
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
          x: 340,
          y: 100,
          width: 80,
          height: 36,
          label: { x: 340, y: 100, width: 10, height: 16 },
          chips: [],
        },
      ],
      edges: [
        {
          edge: go,
          target: "B",
          path: "M140,100 L270,100",
          points: [
            { x: 140, y: 100 },
            { x: 270, y: 100 },
          ],
          label: { x: 200, y: 200, width: 22, height: 16 },
          text: { x: 200, y: 200 },
          dotGap: 6,
        },
      ],
      regions: [
        {
          region: "r",
          x: 266,
          y: 150,
          width: 60,
          height: 100,
          title: { x: 266, y: 114, width: 20, height: 16 },
        },
      ],
      entries: [],
    };
    expect(titleHits(layout).length).toBeGreaterThan(0);
  });

  test("a start state's entry arrow through a region's title is an overlap", () => {
    const layout: MachineLayout = {
      width: 500,
      height: 240,
      messages: [],
      nodes: [
        {
          kind: "state",
          id: "A",
          state: state("A"),
          x: 300,
          y: 100,
          width: 80,
          height: 36,
          label: { x: 300, y: 100, width: 10, height: 16 },
          chips: [],
        },
      ],
      edges: [],
      regions: [
        {
          region: "r",
          x: 200,
          y: 150,
          width: 60,
          height: 140,
          title: { x: 200, y: 100, width: 40, height: 16 },
        },
      ],
      entries: [{ from: { x: 150, y: 100 }, to: { x: 260, y: 100 } }],
    };
    expect(titleHits(layout).length).toBeGreaterThan(0);
  });
});
