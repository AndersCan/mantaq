import type { ActorGraph } from "./graph.ts";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  depth: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  path: string;
  labelX: number;
  labelY: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  direction?: "RIGHT" | "DOWN";
  nodeWidth?: number;
  nodeHeight?: number;
  padding?: number;
}

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_PADDING = 40;
const LEVEL_SPACING = 100;
const NODE_SPACING = 60;

interface ElkNode {
  id: string;
  width: number;
  height: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  label?: string;
  layoutOptions?: Record<string, string>;
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElkLayoutEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
  labels?: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

interface ElkLayoutResult {
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
  width?: number;
  height?: number;
}

let elkInstance: unknown = null;

async function getElk(): Promise<{
  layout: (graph: ElkGraph) => Promise<ElkLayoutResult>;
}> {
  if (elkInstance) return elkInstance as { layout: (graph: ElkGraph) => Promise<ElkLayoutResult> };

  const ELK = (await import("elkjs")).default as unknown as new () => {
    layout: (graph: ElkGraph) => Promise<ElkLayoutResult>;
  };
  elkInstance = new ELK();
  return elkInstance as { layout: (graph: ElkGraph) => Promise<ElkLayoutResult> };
}

function buildElkGraph(graph: ActorGraph, options: LayoutOptions): ElkGraph {
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;

  const elkNodes: ElkNode[] = graph.nodes.map((node) => ({
    id: node.id,
    width: nodeWidth,
    height: nodeHeight,
    layoutOptions: {
      "nodeLabels.alignment": "center",
      "nodeLabels.placement": "T, C, B, L, R",
    },
  }));

  const elkEdges: ElkEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
    label: edge.label,
    layoutOptions: {
      "edge.strategy": "DEFAULT",
      "edge.edgeRouting": "ORTHOGONAL",
    },
  }));

  const direction = options.direction ?? "RIGHT";

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LEVEL_SPACING),
      "elk.spacing.nodeNode": String(NODE_SPACING),
      "elk.padding": `[top=${DEFAULT_PADDING},left=${DEFAULT_PADDING},bottom=${DEFAULT_PADDING},right=${DEFAULT_PADDING}]`,
    },
    children: elkNodes,
    edges: elkEdges,
  };
}

function generateSelfLoopPath(
  cx: number,
  cy: number,
  w: number,
  h: number,
  direction: "RIGHT" | "DOWN",
): string {
  if (direction === "RIGHT") {
    const startX = cx + w / 2;
    const startY = cy - h / 4;
    const loopWidth = w * 0.6;
    const loopHeight = h * 0.8;
    return `M ${startX} ${startY} C ${startX + loopWidth} ${startY - loopHeight}, ${startX + loopWidth} ${startY + loopHeight}, ${startX} ${cy + h / 4}`;
  }
  const startX = cx - w / 4;
  const startY = cy - h / 2;
  const loopWidth = w * 0.8;
  const loopHeight = h * 0.6;
  return `M ${startX} ${startY} C ${startX - loopWidth} ${startY - loopHeight}, ${startX + loopWidth} ${startY - loopHeight}, ${cx + w / 4} ${startY}`;
}

function generateEdgePath(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  tx: number,
  ty: number,
  tw: number,
  th: number,
  direction: "RIGHT" | "DOWN",
): { path: string; labelX: number; labelY: number } {
  if (sx === tx && sy === ty) {
    const cx = sx;
    const cy = sy;
    const path = generateSelfLoopPath(cx, cy, sw, sh, direction);
    return { path, labelX: cx + sw / 2 + 20, labelY: cy };
  }

  if (direction === "RIGHT") {
    const startX = sx + sw / 2;
    const startY = sy;
    const endX = tx - tw / 2;
    const endY = ty;

    const midX = (startX + endX) / 2;
    return {
      path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
      labelX: midX,
      labelY: (startY + endY) / 2 - 10,
    };
  }

  const startX = sx;
  const startY = sy + sh / 2;
  const endX = tx;
  const endY = ty - th / 2;

  const midY = (startY + endY) / 2;
  return {
    path: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2 + 10,
    labelY: midY,
  };
}

export async function computeLayout(
  graph: ActorGraph,
  options?: LayoutOptions,
): Promise<LayoutResult> {
  const opts: LayoutOptions = {
    direction: options?.direction ?? "RIGHT",
    nodeWidth: options?.nodeWidth ?? DEFAULT_NODE_WIDTH,
    nodeHeight: options?.nodeHeight ?? DEFAULT_NODE_HEIGHT,
    padding: options?.padding ?? DEFAULT_PADDING,
  };

  const elk = await getElk();
  const elkGraph = buildElkGraph(graph, opts);

  const elkLayout = await elk.layout(elkGraph);
  const nodeMap = new Map<string, ElkLayoutNode>();
  for (const n of elkLayout.children ?? []) {
    nodeMap.set(n.id, n);
  }

  const layoutNodes: LayoutNode[] = graph.nodes.map((node) => {
    const elkNode = nodeMap.get(node.id);
    return {
      id: node.id,
      x: elkNode?.x ?? 0,
      y: elkNode?.y ?? 0,
      width: opts.nodeWidth!,
      height: opts.nodeHeight!,
      label: node.label,
      isActive: node.isActive,
      isFinal: node.isFinal,
      depth: node.depth,
    };
  });

  const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
    const elkEdge = (elkLayout.edges ?? []).find((e) => e.id === edge.id);
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    const isSelfLoop = edge.source === edge.target;
    let path: string;
    let labelX: number;
    let labelY: number;

    if (isSelfLoop) {
      const result = generateSelfLoopPath(
        sourceNode?.x ?? 0,
        sourceNode?.y ?? 0,
        opts.nodeWidth!,
        opts.nodeHeight!,
        opts.direction!,
      );
      path = result;
      labelX = (sourceNode?.x ?? 0) + opts.nodeWidth! + 20;
      labelY = sourceNode?.y ?? 0;
    } else if (elkEdge?.sections?.[0]) {
      const section = elkEdge.sections[0];
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
      const mid = points[Math.floor(points.length / 2)];
      labelX = mid.x;
      labelY = mid.y - 10;
    } else {
      const result = generateEdgePath(
        sourceNode?.x ?? 0,
        sourceNode?.y ?? 0,
        opts.nodeWidth!,
        opts.nodeHeight!,
        targetNode?.x ?? 0,
        targetNode?.y ?? 0,
        opts.nodeWidth!,
        opts.nodeHeight!,
        opts.direction!,
      );
      path = result.path;
      labelX = result.labelX;
      labelY = result.labelY;
    }

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      isActive: edge.isActive,
      path,
      labelX,
      labelY,
    };
  });

  let maxX = 0;
  let maxY = 0;
  for (const node of layoutNodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + DEFAULT_PADDING * 2,
    height: maxY + DEFAULT_PADDING * 2,
  };
}
