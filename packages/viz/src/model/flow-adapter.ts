/**
 * flow-adapter — VizGraph + LayoutResult → React Flow nodes/edges.
 *
 * - Effect edges are not rendered as flows — they surface as badges on the
 *   source node (visual spec).
 * - Dagre positions are node **centers**; the adapter keeps them as centers
 *   via RF `origin: [0.5, 0.5]` plus fixed `initialWidth`/`initialHeight`
 *   (no measure-flicker, deterministic bounds).
 * - Deterministic ordering: nodes sorted by id, edges kept in graph order.
 */

import type { Edge, Node } from "@xyflow/react";
import type { VizEdge, VizGraph, VizNode, LayoutResult } from "../core/index.ts";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "../core/index.ts";

export const FLOW_NODE_TYPE = "mantaqState" as const;
export const FLOW_EDGE_TYPE = "mantaqEdge" as const;

/** Must match the default layout node size — see layout.ts DEFAULT_*. */
export const FLOW_NODE_WIDTH = DEFAULT_NODE_WIDTH;
export const FLOW_NODE_HEIGHT = DEFAULT_NODE_HEIGHT;

interface FlowNodeData {
  node: VizNode;
  /** True when this is the active node during an actor error. */
  error?: boolean;
  [key: string]: unknown;
}

interface FlowEdgeData {
  edge: VizEdge;
  [key: string]: unknown;
}

export type MantaqFlowNode = Node<FlowNodeData, typeof FLOW_NODE_TYPE>;
export type MantaqFlowEdge = Edge<FlowEdgeData, typeof FLOW_EDGE_TYPE>;

type OkLayout = Extract<LayoutResult, { status: "ok" }>;

export function toFlowNodes(graph: VizGraph, layout: OkLayout): MantaqFlowNode[] {
  return [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => {
      const pos = layout.positions.get(node.id);
      return {
        id: node.id,
        type: FLOW_NODE_TYPE,
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        origin: [0.5, 0.5],
        initialWidth: FLOW_NODE_WIDTH,
        initialHeight: FLOW_NODE_HEIGHT,
        data: { node },
        draggable: false,
        selectable: true,
      } satisfies MantaqFlowNode;
    });
}

export function toFlowEdges(graph: VizGraph): MantaqFlowEdge[] {
  return graph.edges
    .filter((edge) => edge.kind !== "effect")
    .map(
      (edge) =>
        ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: FLOW_EDGE_TYPE,
          label: edge.kind === "undetermined" ? undefined : edge.label,
          data: { edge },
          selectable: true,
          markerEnd:
            edge.kind === "undetermined"
              ? undefined
              : { type: "arrowclosed", width: 16, height: 16, color: "var(--mtq-graph-edge)" },
        }) satisfies MantaqFlowEdge,
    );
}
