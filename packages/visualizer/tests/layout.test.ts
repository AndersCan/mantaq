import { describe, it, expect } from "vite-plus/test";
import {
  defaultPositions,
  computeLayout,
  bezierMidpoint,
  selfLoopPath,
  backwardEdgePath,
  collectAllEdges,
} from "../src/layout.ts";
import type { ActorGraph, GraphNode, GraphEdge } from "../src/graph.ts";

function makeNode(id: string, opts?: { width?: number; height?: number }): GraphNode {
  return {
    id,
    label: id,
    isActive: false,
    isFinal: false,
    depth: 0,
    children: [],
    width: opts?.width ?? 120,
    height: opts?.height ?? 60,
  };
}

describe("defaultPositions", () => {
  it("returns empty array for empty input", () => {
    expect(defaultPositions([])).toEqual([]);
  });

  it("places single node at origin", () => {
    const nodes = [makeNode("a")];
    const result = defaultPositions(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
  });

  it("arranges nodes in grid", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
    const result = defaultPositions(nodes, 120, 60);

    expect(result).toHaveLength(4);

    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);

    expect(result[1].x).toBe(150);
    expect(result[1].y).toBe(0);

    expect(result[2].x).toBe(0);
    expect(result[2].y).toBe(90);

    expect(result[3].x).toBe(150);
    expect(result[3].y).toBe(90);
  });

  it("uses custom dimensions", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const result = defaultPositions(nodes, 200, 100);

    expect(result[0].width).toBe(200);
    expect(result[0].height).toBe(100);
    expect(result[1].width).toBe(200);
    expect(result[1].height).toBe(100);
  });
});

describe("computeLayout", () => {
  it("returns empty result for empty graph", async () => {
    const graph: ActorGraph = { nodes: [], edges: [], activePath: [] };
    const result = await computeLayout(graph);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("computes layout for single node", async () => {
    const graph: ActorGraph = {
      nodes: [makeNode("idle")],
      edges: [],
      activePath: ["idle"],
    };
    const result = await computeLayout(graph);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].x).toBeDefined();
    expect(result.nodes[0].y).toBeDefined();
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("computes layout for nodes with edges", async () => {
    const graph: ActorGraph = {
      nodes: [makeNode("idle"), makeNode("active")],
      edges: [
        { id: "idle->active", source: "idle", target: "active", label: "GO", isActive: false },
      ],
      activePath: ["idle"],
    };
    const result = await computeLayout(graph);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].path).toBeTruthy();
  });

  it("handles self-loop edges", async () => {
    const graph: ActorGraph = {
      nodes: [makeNode("idle")],
      edges: [{ id: "idle->idle", source: "idle", target: "idle", label: "WAIT", isActive: false }],
      activePath: ["idle"],
    };
    const result = await computeLayout(graph);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].path).toContain("C");
  });

  it("respects direction option", async () => {
    const graph: ActorGraph = {
      nodes: [makeNode("a"), makeNode("b")],
      edges: [{ id: "a->b", source: "a", target: "b", label: "E", isActive: false }],
      activePath: ["a"],
    };

    const right = await computeLayout(graph, { direction: "RIGHT" });
    const down = await computeLayout(graph, { direction: "DOWN" });

    expect(right.nodes[0].x).toBeDefined();
    expect(down.nodes[0].y).toBeDefined();
  });

  it("computes label positions at edge midpoints", async () => {
    const graph: ActorGraph = {
      nodes: [makeNode("a"), makeNode("b")],
      edges: [{ id: "a->b", source: "a", target: "b", label: "GO", isActive: false }],
      activePath: ["a"],
    };
    const result = await computeLayout(graph);
    expect(result.edges[0].labelX).toBeDefined();
    expect(result.edges[0].labelY).toBeDefined();
  });
});

describe("bezierMidpoint", () => {
  it("returns midpoint of cubic bezier path", () => {
    const path = "M 0 0 C 25 0, 75 100, 100 100";
    const mid = bezierMidpoint(path);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(50);
  });

  it("returns start point for M-only path", () => {
    const path = "M 10 20 L 30 40";
    const mid = bezierMidpoint(path);
    expect(mid.x).toBe(10);
    expect(mid.y).toBe(20);
  });

  it("returns (0,0) for unparseable path", () => {
    const mid = bezierMidpoint("garbage");
    expect(mid.x).toBe(0);
    expect(mid.y).toBe(0);
  });

  it("handles bezier with non-zero start", () => {
    const path = "M 100 50 C 125 50, 175 150, 200 150";
    const mid = bezierMidpoint(path);
    expect(mid.x).toBeCloseTo(150);
    expect(mid.y).toBeCloseTo(100);
  });
});

describe("selfLoopPath", () => {
  it("returns valid cubic bezier path", () => {
    const path = selfLoopPath(0, 0, 120, 60);
    expect(path).toMatch(
      /^M -?[\d.]+ -?[\d.]+ C -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+$/,
    );
  });

  it("starts at right edge center", () => {
    const path = selfLoopPath(10, 20, 120, 60);
    const match = path.match(/^M ([\d.]+) ([\d.]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(130);
    expect(Number(match![2])).toBe(50);
  });

  it("ends at same point (loop)", () => {
    const path = selfLoopPath(0, 0, 100, 40);
    const parts = path.split(" ");
    const startX = Number(parts[1]);
    const startY = Number(parts[2]);
    const endX = Number(parts[parts.length - 2]);
    const endY = Number(parts[parts.length - 1]);
    expect(endX).toBe(startX);
    expect(endY).toBe(startY);
  });

  it("loop extends beyond node right edge", () => {
    const path = selfLoopPath(0, 0, 100, 40);
    const match = path.match(/C ([\d.]+) /);
    expect(match).not.toBeNull();
    const controlX = Number(match![1]);
    expect(controlX).toBeGreaterThan(100);
  });
});

describe("backwardEdgePath", () => {
  it("returns valid cubic bezier path", () => {
    const path = backwardEdgePath(200, 0, 120, 60, 0, 0, 120);
    expect(path).toMatch(
      /^M -?[\d.]+ -?[\d.]+ C -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+$/,
    );
  });

  it("starts at source bottom center", () => {
    const path = backwardEdgePath(100, 0, 80, 40, 0, 0, 80);
    const match = path.match(/^M ([\d.]+) ([\d.]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(140);
    expect(Number(match![2])).toBe(40);
  });

  it("ends at target top center", () => {
    const path = backwardEdgePath(100, 0, 80, 40, 0, 100, 80);
    const parts = path.split(" ");
    const endX = Number(parts[parts.length - 2]);
    const endY = Number(parts[parts.length - 1]);
    expect(endX).toBe(40);
    expect(endY).toBe(100);
  });

  it("control points dip below midpoint", () => {
    const path = backwardEdgePath(0, 0, 100, 50, 200, 0, 100);
    const match = path.match(/C ([\d.]+) ([\d.]+)/);
    expect(match).not.toBeNull();
    const cy = Number(match![2]);
    expect(cy).toBeGreaterThan(25);
  });
});

describe("collectAllEdges", () => {
  it("returns base edges when no children", () => {
    const edges: GraphEdge[] = [{ id: "1", source: "a", target: "b", label: "E", isActive: false }];
    const nodes: GraphNode[] = [
      { id: "a", label: "a", isActive: false, isFinal: false, depth: 0, children: [] },
    ];
    const result = collectAllEdges(nodes, edges);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("collects edges from children", () => {
    const child: GraphNode = {
      id: "child",
      label: "child",
      isActive: false,
      isFinal: false,
      depth: 1,
      children: [],
    };
    const parent: GraphNode = {
      id: "parent",
      label: "parent",
      isActive: false,
      isFinal: false,
      depth: 0,
      children: [child],
    };
    const baseEdges: GraphEdge[] = [
      { id: "base", source: "x", target: "y", label: "E", isActive: false },
    ];
    const childEdges: GraphEdge[] = [
      { id: "child-edge", source: "a", target: "b", label: "C", isActive: false },
    ];
    const result = collectAllEdges([parent], [...baseEdges, ...childEdges]);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain("base");
    expect(ids).toContain("child-edge");
  });

  it("collects edges from deeply nested children", () => {
    const leaf: GraphNode = {
      id: "leaf",
      label: "leaf",
      isActive: false,
      isFinal: false,
      depth: 2,
      children: [],
    };
    const mid: GraphNode = {
      id: "mid",
      label: "mid",
      isActive: false,
      isFinal: false,
      depth: 1,
      children: [leaf],
    };
    const root: GraphNode = {
      id: "root",
      label: "root",
      isActive: false,
      isFinal: false,
      depth: 0,
      children: [mid],
    };
    const leafEdge: GraphEdge[] = [
      { id: "leaf-e", source: "leaf", target: "root", label: "L", isActive: false },
    ];
    const result = collectAllEdges([root], leafEdge);
    const ids = result.map((e) => e.id);
    expect(ids).toContain("leaf-e");
  });

  it("returns empty when no edges and no children", () => {
    const nodes: GraphNode[] = [
      { id: "a", label: "a", isActive: false, isFinal: false, depth: 0, children: [] },
    ];
    const result = collectAllEdges(nodes, []);
    expect(result).toHaveLength(0);
  });
});
