import type { GraphNode } from "../graph.ts";

export type NodeBodyAttrs = {
  fill: string;
  stroke: string;
  strokeWidth?: number;
  rx?: number;
  ry?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
};

export type NodeLabelAttrs = {
  fill?: string;
  fillOpacity?: number;
  fontWeight?: string;
};

export type NodeAttrs = {
  body: NodeBodyAttrs;
  label?: NodeLabelAttrs;
};

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
    label: {
      fill: isActive ? "#0f172a" : "#64748b",
      fillOpacity: isActive ? 1 : 0.5,
      fontWeight: isActive ? "600" : "400",
    },
  };
}

export function nodeMarkup(): Array<{ tagName: string; selector: string }> {
  return [
    { tagName: "rect", selector: "body" },
    { tagName: "text", selector: "label" },
    { tagName: "circle", selector: "badgeCircle" },
    { tagName: "text", selector: "badgeText" },
  ];
}

export interface BadgeAttrs {
  badgeCircle: {
    r: number;
    ref?: string;
    refX?: string | number;
    refY?: string | number;
    refDx?: number;
    refDy?: number;
    cx?: number;
    cy?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  };
  badgeText: {
    ref?: string;
    refX?: string | number;
    refY?: string | number;
    refDx?: number;
    refDy?: number;
    text: string;
    fill?: string;
    fontSize?: number;
    fontWeight?: string;
    textAnchor?: string;
    textVerticalAnchor?: string;
    x?: number;
    y?: number;
  };
}

export function badgeAttrs(node: GraphNode): BadgeAttrs {
  const effectCount = node.effects?.length ?? 0;
  if (effectCount === 0 || node.isInitial) {
    return {
      badgeCircle: { r: 0 },
      badgeText: { text: "" },
    };
  }
  return {
    badgeCircle: {
      r: 8,
      ref: "body",
      refX: "100%",
      refY: 0,
      refDx: -4,
      refDy: 4,
      cx: 0,
      cy: 0,
      fill: EFFECT_BADGE_FILL,
      stroke: EFFECT_BADGE_STROKE,
      strokeWidth: 1,
    },
    badgeText: {
      ref: "body",
      refX: "100%",
      refY: 0,
      refDx: -4,
      refDy: 4,
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
