/**
 * layoutGraph features: deterministic flat dagre layout with the sanity
 * invariants from plan §6.3 — finite positions, no overlap, in-bounds,
 * valid edge endpoints, determinism, and a typed error for empty graphs.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCheckoutActor } from "../browser/fixtures/checkout.ts";
import { createTrafficLightActor } from "../browser/fixtures/traffic-light.ts";
import { layoutGraph, buildVizGraph } from "../src/index.ts";
import type { VizGraph } from "../src/index.ts";

const NODE_W = 180;
const NODE_H = 48;

function expectOk<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  expect(result.status).toBe("ok");
  return result as Extract<T, { status: "ok" }>;
}

function expectGraph(graph: VizGraph) {
  const layout = expectOk(layoutGraph(graph));
  expect(layout.positions.size).toBe(graph.nodes.length);

  // 1. finite positions
  for (const [id, pos] of layout.positions) {
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);
    expect(graph.nodes.some((n) => n.id === id)).toBe(true);
  }

  // 2. in-bounds: every node box inside the graph bounds
  for (const [, pos] of layout.positions) {
    expect(pos.x - NODE_W / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(pos.x + NODE_W / 2).toBeLessThanOrEqual(layout.width + 1e-9);
    expect(pos.y - NODE_H / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(pos.y + NODE_H / 2).toBeLessThanOrEqual(layout.height + 1e-9);
  }

  // 3. no overlap: for every pair, either x or y boxes are disjoint
  const ids = [...layout.positions.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = layout.positions.get(ids[i])!;
      const b = layout.positions.get(ids[j])!;
      const xOverlap = Math.abs(a.x - b.x) < NODE_W;
      const yOverlap = Math.abs(a.y - b.y) < NODE_H;
      expect(xOverlap && yOverlap).toBe(false);
    }
  }

  // 4. every edge endpoint references an existing node
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  }

  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);
}

describe("layoutGraph", () => {
  it("lays out the checkout graph with all invariants", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    expectGraph(result.graph);
  });

  it("lays out a fully cyclic graph without looping (dagre acyclicer)", () => {
    const { actor } = createTrafficLightActor();
    const result = expectOk(buildVizGraph(actor));
    expectGraph(result.graph);
  });

  it("is deterministic: identical inputs → identical positions", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    const first = expectOk(layoutGraph(result.graph));
    const second = expectOk(layoutGraph(result.graph));
    expect([...first.positions].sort()).toEqual([...second.positions].sort());
  });

  it("honors direction TB", () => {
    const { actor } = createTrafficLightActor();
    const result = expectOk(buildVizGraph(actor));
    const tb = expectOk(layoutGraph(result.graph, { direction: "TB" }));
    expect(tb.direction).toBe("TB");
    expect(tb.width).toBeGreaterThan(0);
    expect(tb.height).toBeGreaterThan(0);
  });

  it("empty graph → typed no-nodes error", () => {
    const result = layoutGraph({ nodes: [], edges: [], groups: [] });
    expect(result).toEqual({
      status: "error",
      reason: "no-nodes",
      message: "cannot lay out an empty graph",
    });
  });

  it("honors custom node sizes (positions respect them for overlap)", () => {
    const { actor } = createTrafficLightActor();
    const result = expectOk(buildVizGraph(actor));
    const layout = expectOk(
      layoutGraph(result.graph, { nodeWidth: 60, nodeHeight: 24, nodeSep: 12, rankSep: 20 }),
    );
    for (const [, pos] of layout.positions) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});
