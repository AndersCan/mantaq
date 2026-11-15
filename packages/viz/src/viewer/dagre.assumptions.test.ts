import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel, Point } from "@dagrejs/dagre";
import { describe, expect, test } from "vite-plus/test";

const NODESEP = 36;
const LABEL_PAD = 8;

function graphOf(): Graph<GraphLabel, NodeLabel, EdgeLabel> {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true, compound: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: NODESEP,
    ranksep: 72,
    edgesep: 14,
    marginx: 48,
    marginy: 48,
  });
  return graph;
}

function addStates(graph: ReturnType<typeof graphOf>, names: string[]): void {
  for (const name of names) graph.setNode(name, { width: 80, height: 36 });
}

describe("dagre behaviour the layout will rely on", () => {
  test("places a labelpos r label box labeloffset below the edge point in LR", () => {
    const graph = graphOf();
    addStates(graph, ["a", "b"]);
    graph.setEdge("a", "b", { width: 60, height: 16, labelpos: "r", labeloffset: 8 }, "e");
    layout(graph);
    const edge = graph.edge("a", "b", "e");
    const points: Point[] = edge.points ?? [];
    const onPath = points.reduce((best: Point, point: Point) =>
      Math.abs(point.x - (edge.x ?? 0)) < Math.abs(best.x - (edge.x ?? 0)) ? point : best,
    );
    expect(edge.y).toBeCloseTo(onPath.y + 8 + 16 / 2 + 0, 0);
  });

  test("keeps members LABEL_PAD inside a compound's border and non-members LABEL_PAD outside", () => {
    const graph = graphOf();
    addStates(graph, ["a", "b", "c"]);
    graph.setNode("r", { width: 0, height: 0 });
    graph.setParent("b", "r");
    graph.setParent("c", "r");
    graph.setEdge("a", "b", { width: 40, height: 16, labelpos: "r", labeloffset: 8 }, "e1");
    graph.setEdge("b", "c", { width: 40, height: 16, labelpos: "r", labeloffset: 8 }, "e2");
    layout(graph);
    const region = graph.node("r");
    const sides = (node: NodeLabel) => ({
      left: (node.x ?? 0) - node.width / 2,
      right: (node.x ?? 0) + node.width / 2,
      top: (node.y ?? 0) - node.height / 2,
      bottom: (node.y ?? 0) + node.height / 2,
    });
    const border = sides(region);
    const members = [...["b", "c"].map((name) => graph.node(name)), graph.edge("b", "c", "e2")];
    for (const member of members) {
      const inner = sides(member);
      expect(inner.left - border.left).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(border.right - inner.right).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(inner.top - border.top).toBeGreaterThanOrEqual(LABEL_PAD);
      expect(border.bottom - inner.bottom).toBeGreaterThanOrEqual(LABEL_PAD);
    }
    const outside = sides(graph.node("a"));
    expect(border.left - outside.right).toBeGreaterThanOrEqual(LABEL_PAD);
  });

  test("keeps an edge's inner points out of every node it does not end at", () => {
    const graph = graphOf();
    addStates(graph, ["a", "b", "c", "d"]);
    graph.setEdge("a", "b", { width: 40, height: 16 }, "ab");
    graph.setEdge("b", "c", { width: 40, height: 16 }, "bc");
    graph.setEdge("c", "d", { width: 40, height: 16 }, "cd");
    graph.setEdge("a", "d", { width: 40, height: 16 }, "ad");
    graph.setEdge("a", "c", { width: 40, height: 16 }, "ac");
    layout(graph);
    for (const { v, w, name } of graph.edges()) {
      const points = graph.edge(v, w, name).points ?? [];
      for (const point of points.slice(1, -1)) {
        for (const other of graph.nodes().filter((each: string) => each !== v && each !== w)) {
          const node = graph.node(other);
          const inside =
            Math.abs(point.x - (node.x ?? 0)) < node.width / 2 &&
            Math.abs(point.y - (node.y ?? 0)) < node.height / 2;
          expect(inside, `${name} at ${point.x},${point.y} inside ${other}`).toBe(false);
        }
      }
    }
  });
});
