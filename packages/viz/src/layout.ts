import dagre from "@dagrejs/dagre";
import type { GraphNode, GraphEdge } from "./graph.ts";

export interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  nodesep?: number;
  ranksep?: number;
  router?: "normal" | "orth" | "manhattan" | "metro" | "er";
}

function resolveOptions(opts?: LayoutOptions): Required<LayoutOptions> {
  return {
    direction: opts?.direction ?? "TB",
    nodeWidth: opts?.nodeWidth ?? 160,
    nodeHeight: opts?.nodeHeight ?? 60,
    nodesep: opts?.nodesep ?? 80,
    ranksep: opts?.ranksep ?? 160,
    router: opts?.router ?? "normal",
  };
}

export function computeNodePositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts?: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const options = resolveOptions(opts);
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: options.direction,
    nodesep: options.nodesep,
    ranksep: options.ranksep,
  });

  for (const n of nodes) {
    const w = n.isInitial ? 30 : options.nodeWidth;
    const h = n.isInitial ? 30 : options.nodeHeight;
    g.setNode(n.id, { width: w, height: h });
  }

  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const dagreNode = g.node(n.id);
    if (dagreNode) {
      const w = n.isInitial ? 30 : options.nodeWidth;
      const h = n.isInitial ? 30 : options.nodeHeight;
      positions.set(n.id, {
        x: dagreNode.x - w / 2,
        y: dagreNode.y - h / 2,
      });
    } else {
      positions.set(n.id, { x: 0, y: 0 });
    }
  }

  return positions;
}
