import type { GraphNode } from "../graph.ts";

export interface NodeBodyAttrs {
  fill: string;
  stroke: string;
  strokeWidth?: number;
  rx?: number;
  ry?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
}

export interface NodeTextAttrs {
  fill?: string;
  fillOpacity?: number;
  fontWeight?: string;
}

export interface NodeAttrs {
  body: NodeBodyAttrs;
  text?: NodeTextAttrs;
}

const FINAL_COLOR = "#059669";
const ACTIVE_COLOR = "#3b82f6";
const INACTIVE_COLOR = "#64748b";
const ACTIVE_FILL = "#eff6ff";
const INACTIVE_FILL = "#ffffff";
const INITIAL_FILL = "#1e293b";

export function nodeTooltip(node: GraphNode): string {
  if (node.isInitial) return "Initial State";
  return `State: ${node.label}\nActive: ${node.isActive ? "yes" : "no"}\nFinal: ${node.isFinal ? "yes" : "no"}`;
}

export function nodeAttrs(node: GraphNode): NodeAttrs {
  if (node.isInitial) {
    return { body: { fill: INITIAL_FILL, stroke: "none" } };
  }

  const isActive = node.isActive;
  const isFinal = node.isFinal;

  return {
    body: {
      stroke: isFinal ? FINAL_COLOR : isActive ? ACTIVE_COLOR : INACTIVE_COLOR,
      strokeWidth: isFinal ? 2.5 : isActive ? 2.5 : 1,
      fill: isActive ? ACTIVE_FILL : INACTIVE_FILL,
      fillOpacity: isActive ? 1 : 0.5,
      strokeOpacity: isActive ? 1 : 0.4,
      rx: 8,
      ry: 8,
    },
    text: {
      fill: isActive ? "#0f172a" : "#64748b",
      fillOpacity: isActive ? 1 : 0.5,
      fontWeight: isActive ? "600" : "400",
    },
  };
}
