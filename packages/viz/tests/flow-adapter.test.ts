/**
 * flow-adapter tests — VizGraph/LayoutResult → React Flow nodes/edges.
 *
 * - nodes: sorted by id, center origin, fixed initial size, not draggable,
 *   positions from the layout,
 * - edges: effect edges filtered out, undetermined edges have no label and
 *   no marker, transitions carry a marker + label.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCheckoutActor } from "../browser/fixtures/real/checkout.ts";
import { buildVizGraph, layoutGraph } from "../src/core/index.ts";
import {
  FLOW_EDGE_TYPE,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_TYPE,
  FLOW_NODE_WIDTH,
  toFlowEdges,
  toFlowNodes,
} from "../src/model/flow-adapter.ts";

function okModel() {
  const { actor } = createCheckoutActor();
  const result = buildVizGraph(actor);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("fixture graph failed to build");
  const layout = layoutGraph(result.graph);
  expect(layout.status).toBe("ok");
  if (layout.status !== "ok") throw new Error("fixture layout failed");
  return { graph: result.graph, layout };
}

describe("toFlowNodes", () => {
  it("maps every state node, sorted by id, with layout positions", () => {
    const { graph, layout } = okModel();
    const nodes = toFlowNodes(graph, layout);

    expect(nodes).toHaveLength(graph.nodes.length);
    expect(nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id).sort());
    for (const node of nodes) {
      expect(node.type).toBe(FLOW_NODE_TYPE);
      expect(node.origin).toEqual([0.5, 0.5]);
      expect(node.initialWidth).toBe(FLOW_NODE_WIDTH);
      expect(node.initialHeight).toBe(FLOW_NODE_HEIGHT);
      expect(node.draggable).toBe(false);
      expect(node.data.node.id).toBe(node.id);
      expect(layout.positions.get(node.id)).toBeDefined();
      expect(node.position).toEqual(layout.positions.get(node.id));
    }
  });
});

describe("toFlowEdges", () => {
  it("drops effect edges, keeps transition edges with labels and markers", () => {
    const { graph } = okModel();
    const edges = toFlowEdges(graph);

    const effectEdges = graph.edges.filter((e) => e.kind === "effect");
    expect(effectEdges.length).toBeGreaterThan(0);
    expect(edges).toHaveLength(graph.edges.length - effectEdges.length);
    expect(edges.some((e) => e.data!.edge.kind === "effect")).toBe(false);

    for (const edge of edges) {
      expect(edge.type).toBe(FLOW_EDGE_TYPE);
      expect(edge.data!.edge.id).toBe(edge.id);
    }
    // undetermined edges: normalized self-loops, no label, no arrowhead
    const undetermined = edges.filter((e) => e.data!.edge.kind === "undetermined");
    for (const edge of undetermined) {
      expect(edge.label).toBeUndefined();
      expect(edge.markerEnd).toBeUndefined();
      expect(edge.source).toBe(edge.target);
    }
    // regular transitions: label + arrowhead marker
    const transitions = edges.filter((e) => e.data!.edge.kind === "transition");
    expect(transitions.length).toBeGreaterThan(0);
    for (const edge of transitions) {
      expect(edge.label).toBe(edge.data!.edge.label);
      expect(edge.markerEnd).toBeDefined();
    }
  });
});
