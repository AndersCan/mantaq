import type { GraphEdge } from "../graph.ts";

const EFFECT_AMBER = "#d97706";
const EFFECT_FILL = "#fffbeb";
const EFFECT_STROKE = "#fbbf24";
const ACTIVE_BLUE = "#3b82f6";
const ACTIVE_LABEL_FILL = "#dbeafe";
const ACTIVE_LABEL_STROKE = "#3b82f6";
const UNDETERMINED_RED = "#ef4444";
const UNDETERMINED_FILL = "#fef2f2";
const INACTIVE_GRAY = "#cbd5e1";
const INACTIVE_LABEL_FILL = "#f8fafc";
const INACTIVE_LABEL_STROKE = "#e2e8f0";

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
  strokeOpacity?: number;
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

export interface EdgeTheme {
  labelColor: string;
  labelFill: string;
  labelStroke: string;
  lineColor: string;
  lineWidth: number;
  lineDash: number | undefined;
  lineOpacity: number;
  marchingStyle: Record<string, unknown> | undefined;
}

export function edgeTheme(edge: GraphEdge): EdgeTheme {
  if (edge.isUndetermined) {
    return {
      labelColor: UNDETERMINED_RED,
      labelFill: UNDETERMINED_FILL,
      labelStroke: UNDETERMINED_RED,
      lineColor: UNDETERMINED_RED,
      lineWidth: 1.5,
      lineDash: 5,
      lineOpacity: 1,
      marchingStyle: { animation: "ant-march 60s infinite linear" },
    };
  }
  if (edge.isEffectTriggered) {
    return {
      labelColor: EFFECT_AMBER,
      labelFill: EFFECT_FILL,
      labelStroke: EFFECT_STROKE,
      lineColor: EFFECT_AMBER,
      lineWidth: 1.5,
      lineDash: 5,
      lineOpacity: 1,
      marchingStyle: { animation: "ant-march 60s infinite linear" },
    };
  }
  if (edge.isActive) {
    return {
      labelColor: "#0f172a",
      labelFill: ACTIVE_LABEL_FILL,
      labelStroke: ACTIVE_LABEL_STROKE,
      lineColor: ACTIVE_BLUE,
      lineWidth: 2.5,
      lineDash: undefined,
      lineOpacity: 1,
      marchingStyle: undefined,
    };
  }
  return {
    labelColor: "#94a3b8",
    labelFill: INACTIVE_LABEL_FILL,
    labelStroke: INACTIVE_LABEL_STROKE,
    lineColor: INACTIVE_GRAY,
    lineWidth: 1,
    lineDash: 4,
    lineOpacity: 0.35,
    marchingStyle: undefined,
  };
}

export function edgeLabel(edge: GraphEdge): EdgeLabelAttrs {
  const t = edgeTheme(edge);
  const text = edge.label;
  return {
    position: { distance: 0.4 },
    attrs: {
      label: {
        text,
        fontSize: 12,
        fill: t.labelColor,
        fontWeight: "600",
        cursor: "pointer",
      },
      body: {
        fill: t.labelFill,
        stroke: t.labelStroke,
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
  const t = edgeTheme(edge);
  return {
    stroke: t.lineColor,
    strokeWidth: t.lineWidth,
    strokeDasharray: t.lineDash,
    strokeOpacity: t.lineOpacity,
    targetMarker: { name: "classic", size: 8 },
    cursor: "pointer",
    ...t.marchingStyle,
  };
}

export function edgeTooltip(edge: GraphEdge): string {
  const parts = [`Event: ${edge.label}`];
  if (!edge.isUndetermined) {
    parts.push(`${edge.source} → ${edge.target}`);
  }
  parts.push(`Internal: ${edge.isInternal ? "yes" : "no"}`);
  if (edge.isUndetermined) {
    parts.push("Target: undetermined");
  }
  return parts.join("\n");
}

export function edgeData(edge: GraphEdge): Record<string, unknown> {
  return {
    isActive: edge.isActive,
    eventId: edge.label,
    isUndetermined: edge.isUndetermined,
    timerMs: edge.timerMs,
    tooltip: edgeTooltip(edge),
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
