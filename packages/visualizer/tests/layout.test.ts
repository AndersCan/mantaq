import { describe, it, expect } from "vite-plus/test";
import { defaultPositions, computeLayout } from "../src/layout.ts";
import type { ActorGraph, GraphNode } from "../src/graph.ts";

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
