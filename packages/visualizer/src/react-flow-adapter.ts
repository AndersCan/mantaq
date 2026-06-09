import type { Node, Edge } from "@xyflow/react";
import type { ActorGraph, GraphNode, GraphEdge } from "./graph.ts";

export type StateNodeData = {
  label: string;
  isActive: boolean;
  isFinal: boolean;
};

export type StateNode = Node<StateNodeData, "state">;
export type StateEdge = Edge;

export function toReactFlowNodes(graphNodes: GraphNode[]): StateNode[] {
  return graphNodes.map((n, i) => ({
    id: n.id,
    type: "state" as const,
    position: { x: 0, y: i * 120 },
    data: {
      label: n.label,
      isActive: n.isActive,
      isFinal: n.isFinal,
    },
  }));
}

export function toReactFlowEdges(graphEdges: GraphEdge[]): StateEdge[] {
  return graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "default" as const,
    data: {
      isActive: e.isActive,
      payload: e.payload,
    },
  }));
}

export function actorGraphToFlow(graph: ActorGraph): {
  nodes: StateNode[];
  edges: StateEdge[];
} {
  return {
    nodes: toReactFlowNodes(graph.nodes),
    edges: toReactFlowEdges(graph.edges),
  };
}
