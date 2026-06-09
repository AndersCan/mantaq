import type { Node, Edge } from "@xyflow/react";
import type { ActorGraph, GraphNode, GraphEdge, TransitionPayload } from "./graph.ts";
import { computeNodePositions } from "./layout.ts";
import type { LayoutOptions } from "./layout.ts";

export type StateNodeData = {
  label: string;
  isActive: boolean;
  isFinal: boolean;
};

export type StateEdgeData = {
  isActive: boolean;
  payload?: TransitionPayload;
};

export type StateNode = Node<StateNodeData, "state">;
export type StateEdge = Edge<StateEdgeData, "state-edge">;

export function toReactFlowNodes(
  graphNodes: GraphNode[],
  edges: GraphEdge[] = [],
  layoutOpts?: LayoutOptions,
): StateNode[] {
  const positions = computeNodePositions(graphNodes, edges, layoutOpts);

  return graphNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "state" as const,
      position: pos,
      data: {
        label: n.label,
        isActive: n.isActive,
        isFinal: n.isFinal,
      },
    };
  });
}

export function toReactFlowEdges(graphEdges: GraphEdge[]): StateEdge[] {
  return graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "state-edge" as const,
    data: {
      isActive: e.isActive,
      payload: e.payload,
    },
  }));
}

export function actorGraphToFlow(
  graph: ActorGraph,
  layoutOpts?: LayoutOptions,
): {
  nodes: StateNode[];
  edges: StateEdge[];
} {
  return {
    nodes: toReactFlowNodes(graph.nodes, graph.edges, layoutOpts),
    edges: toReactFlowEdges(graph.edges),
  };
}
