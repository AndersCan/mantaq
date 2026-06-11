import type { GraphEdge } from "../graph.ts";

const EFFECT_AMBER = "#d97706";
const EFFECT_FILL = "#fffbeb";
const EFFECT_STROKE = "#fbbf24";
const ACTIVE_BLUE = "#3b82f6";
const ACTIVE_LABEL_FILL = "#e2e8f0";
const ACTIVE_LABEL_STROKE = "#94a3b8";
const INACTIVE_GRAY = "#94a3b8";
const INACTIVE_LABEL_FILL = "#f1f5f9";
const INACTIVE_LABEL_STROKE = "#cbd5e1";

export interface EdgeLabelAttrs {
  position: { distance: number };
  attrs: {
    label: {
      text: string;
      fontSize: number;
      fill: string;
      fontWeight: string;
      cursor: string;
    };
    body: {
      fill: string;
      stroke: string;
      strokeWidth: number;
      rx: number;
      ry: number;
      refWidth: string;
      refHeight: string;
      refX: string;
      refY: string;
      cursor: string;
    };
  };
}

export interface EdgeLineAttrs {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: number;
  targetMarker: { name: string; size: number };
  cursor: string;
  style?: Record<string, unknown>;
}

export interface EdgeConfig {
  id: string;
  shape: string;
  source: string;
  target: string;
  z: number;
  router: { name: string };
  connector: { name: string };
  data: Record<string, unknown>;
  labels: EdgeLabelAttrs[];
  attrs: { line: EdgeLineAttrs };
}

function isEffect(edge: GraphEdge): boolean {
  return edge.isActive && !!edge.isInternal;
}

function effectLabel(edge: GraphEdge): string {
  return edge.effectLabel ?? "Effect";
}

function labelColor(edge: GraphEdge): string {
  return isEffect(edge) ? EFFECT_AMBER : edge.isActive ? "#0f172a" : INACTIVE_GRAY;
}

function labelFill(edge: GraphEdge): string {
  return isEffect(edge) ? EFFECT_FILL : edge.isActive ? ACTIVE_LABEL_FILL : INACTIVE_LABEL_FILL;
}

function labelStroke(edge: GraphEdge): string {
  return isEffect(edge)
    ? EFFECT_STROKE
    : edge.isActive
      ? ACTIVE_LABEL_STROKE
      : INACTIVE_LABEL_STROKE;
}

function lineColor(edge: GraphEdge): string {
  return isEffect(edge) ? EFFECT_AMBER : edge.isActive ? ACTIVE_BLUE : INACTIVE_GRAY;
}

function lineWidth(edge: GraphEdge): number {
  return isEffect(edge) ? 1.5 : edge.isActive ? 2 : 1;
}

function lineDash(edge: GraphEdge): number | undefined {
  if (isEffect(edge)) return 5;
  if (!edge.isActive) return 3;
  return undefined;
}

function marchingStyle(edge: GraphEdge): Record<string, unknown> | undefined {
  return isEffect(edge) ? { animation: "ant-march 60s infinite linear" } : undefined;
}

export function edgeLabel(edge: GraphEdge): EdgeLabelAttrs {
  const text = isEffect(edge) ? effectLabel(edge) : edge.label;
  return {
    position: { distance: 0.4 },
    attrs: {
      label: {
        text,
        fontSize: 12,
        fill: labelColor(edge),
        fontWeight: "600",
        cursor: "pointer",
      },
      body: {
        fill: labelFill(edge),
        stroke: labelStroke(edge),
        strokeWidth: 1,
        rx: 4,
        ry: 4,
        refWidth: "160%",
        refHeight: "160%",
        refX: "-30%",
        refY: "-30%",
        cursor: "pointer",
      },
    },
  };
}

export function edgeLine(edge: GraphEdge): EdgeLineAttrs {
  return {
    stroke: lineColor(edge),
    strokeWidth: lineWidth(edge),
    strokeDasharray: lineDash(edge),
    targetMarker: { name: "classic", size: 8 },
    cursor: "pointer",
    ...marchingStyle(edge),
  };
}

export function edgeData(edge: GraphEdge): Record<string, unknown> {
  return {
    isActive: edge.isActive,
    eventId: edge.label,
    isEffect: isEffect(edge),
    timerMs: edge.timerMs,
  };
}

export function edgeConfig(edge: GraphEdge, routerName: string = "normal"): EdgeConfig {
  return {
    id: edge.id,
    shape: "edge",
    source: edge.source,
    target: edge.target,
    z: 2,
    router: { name: routerName },
    connector: { name: "smooth" },
    data: edgeData(edge),
    labels: [edgeLabel(edge)],
    attrs: { line: edgeLine(edge) },
  };
}
