import { describe, it, expect } from "vite-plus/test";
import { computeLayout } from "../src/layout.ts";
import type { ActorGraph } from "../src/graph.ts";

const simpleGraph: ActorGraph = {
  nodes: [
    { id: "idle", label: "idle", isActive: true, isFinal: false, depth: 0, parentId: null },
    { id: "loading", label: "loading", isActive: false, isFinal: false, depth: 0, parentId: null },
    { id: "done", label: "done", isActive: false, isFinal: true, depth: 0, parentId: null },
  ],
  edges: [
    { id: "idle->loading", source: "idle", target: "loading", label: "FETCH", isActive: true },
    { id: "loading->done", source: "loading", target: "done", label: "SUCCESS", isActive: false },
  ],
  activePath: ["idle"],
};

const selfLoopGraph: ActorGraph = {
  nodes: [
    { id: "active", label: "active", isActive: true, isFinal: false, depth: 0, parentId: null },
  ],
  edges: [
    { id: "active->active", source: "active", target: "active", label: "PING", isActive: true },
  ],
  activePath: ["active"],
};

const complexGraph: ActorGraph = {
  nodes: [
    { id: "a", label: "a", isActive: true, isFinal: false, depth: 0, parentId: null },
    { id: "b", label: "b", isActive: false, isFinal: false, depth: 0, parentId: null },
    { id: "c", label: "c", isActive: false, isFinal: false, depth: 0, parentId: null },
    { id: "d", label: "d", isActive: false, isFinal: true, depth: 0, parentId: null },
  ],
  edges: [
    { id: "a->b", source: "a", target: "b", label: "GO", isActive: true },
    { id: "b->c", source: "b", target: "c", label: "NEXT", isActive: false },
    { id: "c->d", source: "c", target: "d", label: "FINISH", isActive: false },
    { id: "b->a", source: "b", target: "a", label: "BACK", isActive: false },
  ],
  activePath: ["a"],
};

const emptyGraph: ActorGraph = {
  nodes: [],
  edges: [],
  activePath: [],
};

describe("computeLayout", () => {
  it("returns layout result for simple graph", async () => {
    const result = await computeLayout(simpleGraph);

    expect(result).toBeDefined();
    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBe(2);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("positions nodes with valid coordinates", async () => {
    const result = await computeLayout(simpleGraph);

    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it("nodes preserve labels", async () => {
    const result = await computeLayout(simpleGraph);

    const labels = result.nodes.map((n) => n.label);
    expect(labels).toContain("idle");
    expect(labels).toContain("loading");
    expect(labels).toContain("done");
  });

  it("nodes preserve active state", async () => {
    const result = await computeLayout(simpleGraph);

    const active = result.nodes.find((n) => n.isActive);
    expect(active).toBeDefined();
    expect(active!.label).toBe("idle");
  });

  it("nodes preserve final state", async () => {
    const result = await computeLayout(simpleGraph);

    const done = result.nodes.find((n) => n.label === "done");
    expect(done!.isFinal).toBe(true);
  });

  it("edges have valid paths", async () => {
    const result = await computeLayout(simpleGraph);

    for (const edge of result.edges) {
      expect(edge.path).toBeTruthy();
      expect(edge.path.length).toBeGreaterThan(0);
    }
  });

  it("edges have label positions", async () => {
    const result = await computeLayout(simpleGraph);

    for (const edge of result.edges) {
      expect(typeof edge.labelX).toBe("number");
      expect(typeof edge.labelY).toBe("number");
    }
  });

  it("handles self-loop graph", async () => {
    const result = await computeLayout(selfLoopGraph);

    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(1);

    const selfLoop = result.edges[0];
    expect(selfLoop.path).toContain("C");
  });

  it("handles complex graph with 4 nodes", async () => {
    const result = await computeLayout(complexGraph);

    expect(result.nodes.length).toBe(4);
    expect(result.edges.length).toBe(4);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("handles empty graph", async () => {
    const result = await computeLayout(emptyGraph);

    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
  });

  it("respects direction option DOWN", async () => {
    const result = await computeLayout(simpleGraph, { direction: "DOWN" });

    expect(result.nodes.length).toBe(3);
    expect(result.height).toBeGreaterThan(0);
  });

  it("respects direction option RIGHT", async () => {
    const result = await computeLayout(simpleGraph, { direction: "RIGHT" });

    expect(result.nodes.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
  });

  it("respects custom nodeWidth", async () => {
    const result = await computeLayout(simpleGraph, { nodeWidth: 200 });

    for (const node of result.nodes) {
      expect(node.width).toBe(200);
    }
  });

  it("respects custom nodeHeight", async () => {
    const result = await computeLayout(simpleGraph, { nodeHeight: 80 });

    for (const node of result.nodes) {
      expect(node.height).toBe(80);
    }
  });

  it("nodes do not overlap in simple graph", async () => {
    const result = await computeLayout(simpleGraph, { direction: "RIGHT" });

    const nodes = result.nodes.sort((a, b) => a.x - b.x);
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      expect(curr.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });

  it("layout is deterministic", async () => {
    const result1 = await computeLayout(simpleGraph);
    const result2 = await computeLayout(simpleGraph);

    expect(result1.nodes.length).toBe(result2.nodes.length);
    for (let i = 0; i < result1.nodes.length; i++) {
      expect(result1.nodes[i].x).toBe(result2.nodes[i].x);
      expect(result1.nodes[i].y).toBe(result2.nodes[i].y);
    }
  });
});
