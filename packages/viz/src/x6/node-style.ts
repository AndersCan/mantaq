import type { GraphNode } from "../graph.ts";

export interface NodeAttrs {
  body: {
    fill: string;
    stroke: string;
    strokeWidth?: number;
    rx?: number;
    ry?: number;
  };
}

const FINAL_COLOR = "#059669";
const ACTIVE_COLOR = "#3b82f6";
const INACTIVE_COLOR = "#64748b";
const ACTIVE_FILL = "#eff6ff";
const INACTIVE_FILL = "#ffffff";
const INITIAL_FILL = "#1e293b";

export function nodeAttrs(node: GraphNode): NodeAttrs {
  if (node.isInitial) {
    return { body: { fill: INITIAL_FILL, stroke: "none" } };
  }

  return {
    body: {
      stroke: node.isFinal ? FINAL_COLOR : node.isActive ? ACTIVE_COLOR : INACTIVE_COLOR,
      strokeWidth: node.isFinal ? 2.5 : node.isActive ? 2 : 1,
      fill: node.isActive ? ACTIVE_FILL : INACTIVE_FILL,
      rx: 8,
      ry: 8,
    },
  };
}
