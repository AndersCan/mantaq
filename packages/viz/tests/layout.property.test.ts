/**
 * Layout PBT (plan §6.3 + §9.6): over arbitrary random graphs, the layout
 * must satisfy the sanity invariants — all positions finite, no two nodes
 * overlapping, all node boxes within the computed graph bounds, every edge
 * endpoint references an existing node. A deterministic-but-broken layout
 * (all-at-origin) must fail this suite.
 */

import { describe, expect } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { layoutGraph } from "../src/index.ts";
import type { VizGraph, VizNode, VizEdge, LayoutDirection } from "../src/index.ts";

const NODE_W = 180;
const NODE_H = 48;

const anyEdgeKind = fc.constantFrom("transition", "undetermined", "effect", "initial");

/** Arbitrary graph: 1–12 uniquely-id'd nodes, 0–3×count edges (incl. self-loops). */
function anyVizGraph(): fc.Arbitrary<VizGraph> {
  return fc.integer({ min: 1, max: 12 }).chain((count) => {
    const nodeIds = Array.from({ length: count }, (_, i) => `n${i}`);
    const idArb = fc.constantFrom(...nodeIds);
    return fc
      .array(fc.tuple(idArb, idArb, anyEdgeKind), { minLength: 0, maxLength: count * 3 })
      .map((specs): VizGraph => {
        const nodes: VizNode[] = nodeIds.map((id) => ({
          id,
          label: id,
          kind: "state",
          isActive: false,
          isFinal: false,
          isInitial: false,
          effects: [],
          groupId: "",
          parentPath: "",
        }));
        const edges: VizEdge[] = specs.map(([source, target, kind], i) => ({
          id: `e${i}`,
          source,
          target: kind === "undetermined" ? source : target,
          label: `ev${i}`,
          kind,
          isActive: false,
          isInternal: kind === "effect",
        }));
        return { nodes, edges, groups: [] };
      });
  });
}

function expectInvariants(graph: VizGraph, direction: LayoutDirection): void {
  const layout = layoutGraph(graph, { direction });
  expect(layout.status).toBe("ok");
  if (layout.status !== "ok") return;

  const { positions, width, height } = layout;
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  expect(positions.size).toBe(nodeIds.size);

  for (const [id, pos] of positions) {
    expect(nodeIds.has(id)).toBe(true);
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);

    expect(pos.x - NODE_W / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(pos.x + NODE_W / 2).toBeLessThanOrEqual(width + 1e-9);
    expect(pos.y - NODE_H / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(pos.y + NODE_H / 2).toBeLessThanOrEqual(height + 1e-9);
  }

  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i][1];
      const b = entries[j][1];
      const xOverlap = Math.abs(a.x - b.x) < NODE_W - 1e-9;
      const yOverlap = Math.abs(a.y - b.y) < NODE_H - 1e-9;
      expect(xOverlap && yOverlap).toBe(false);
    }
  }

  for (const edge of graph.edges) {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  }

  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
}

describe("layout invariants (property)", () => {
  runProperty(anyVizGraph(), (graph) => {
    expectInvariants(graph, "LR");
    expectInvariants(graph, "TB");
  });

  runProperty(anyVizGraph(), (graph) => {
    // determinism: same input → same positions
    const a = layoutGraph(graph);
    const b = layoutGraph(graph);
    expect(a.status).toBe(b.status);
    if (a.status !== "ok" || b.status !== "ok") return;
    expect([...a.positions.entries()].sort()).toEqual([...b.positions.entries()].sort());
  });
});
