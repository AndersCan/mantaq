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

export interface NodeBadgeAttrs {
  circle: {
    fill: string;
    stroke: string;
    display?: string;
  };
  text: {
    fill: string;
    text: string;
    display?: string;
  };
}

export interface NodeAttrs {
  body: NodeBodyAttrs;
  text?: NodeTextAttrs;
  badge?: NodeBadgeAttrs;
}

const FINAL_COLOR = "#059669";
const ACTIVE_COLOR = "#3b82f6";
const INACTIVE_COLOR = "#64748b";
const ACTIVE_FILL = "#eff6ff";
const INACTIVE_FILL = "#ffffff";
const INITIAL_FILL = "#1e293b";
const EFFECT_BADGE_FILL = "#f59e0b";
const EFFECT_BADGE_STROKE = "#d97706";

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
  const effectCount = node.effects?.length ?? 0;

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
    badge: {
      circle: {
        fill: EFFECT_BADGE_FILL,
        stroke: EFFECT_BADGE_STROKE,
        display: effectCount > 0 ? "block" : "none",
      },
      text: {
        fill: "#ffffff",
        text: effectCount > 0 ? `${effectCount}` : "",
        display: effectCount > 0 ? "block" : "none",
      },
    },
  };
}

export function nodeMarkup(): Array<{ tagName: string; selector: string }> {
  return [
    { tagName: "rect", selector: "body" },
    { tagName: "text", selector: "label" },
    { tagName: "g", selector: "badgeGroup" },
    { tagName: "circle", selector: "badgeCircle" },
    { tagName: "text", selector: "badgeText" },
  ];
}

export function badgeAttrs(node: GraphNode): Record<string, unknown> {
  const effectCount = node.effects?.length ?? 0;
  if (effectCount === 0 || node.isInitial) {
    return {};
  }
  return {
    badgeGroup: {
      ref: "body",
      refX: "100%",
      refY: 0,
      refDx: -4,
      refDy: 4,
    },
    badgeCircle: {
      r: 8,
      cx: 0,
      cy: 0,
      fill: EFFECT_BADGE_FILL,
      stroke: EFFECT_BADGE_STROKE,
      strokeWidth: 1,
    },
    badgeText: {
      text: `${effectCount}`,
      fill: "#ffffff",
      fontSize: 9,
      fontWeight: "700",
      textAnchor: "middle",
      textVerticalAnchor: "middle",
      x: 0,
      y: 0,
    },
  };
}
