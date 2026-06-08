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
  elkOptions?: Record<string, string>;
}

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_PADDING = 40;

interface ElkNode {
  id: string;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
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
  sections: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

interface ElkLayoutResult {
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
}

type ElkLayoutApi = { layout: (graph: ElkGraph) => Promise<ElkLayoutResult> };
let elkInstance: ElkLayoutApi | null = null;

async function getElk(): Promise<ElkLayoutApi> {
  if (elkInstance) return elkInstance;
  const ELK = (await import("elkjs")).default as unknown as new () => ElkLayoutApi;
  elkInstance = new ELK();
  return elkInstance;
}

function buildElkGraph(graph: ActorGraph, options: LayoutOptions): ElkGraph {
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const direction = options.direction ?? "RIGHT";

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.nodeNode": "60",
      "elk.padding": `[top=${DEFAULT_PADDING},left=${DEFAULT_PADDING},bottom=${DEFAULT_PADDING},right=${DEFAULT_PADDING}]`,
      "elk.layered.considerModelOrder": "true",
      ...options.elkOptions,
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
      layoutOptions: {
        "nodeLabels.alignment": "center",
        "nodeLabels.placement": "T, C, B, L, R",
      },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
      layoutOptions: {
        "edge.strategy": "DEFAULT",
        "edge.edgeRouting": "ORTHOGONAL",
      },
    })),
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
  tx: number,
  ty: number,
  nodeW: number,
  nodeH: number,
  direction: "RIGHT" | "DOWN",
): { path: string; labelX: number; labelY: number } {
  if (direction === "RIGHT") {
    const startX = sx + nodeW / 2;
    const startY = sy + nodeH / 2;
    const endX = tx - nodeW / 2;
    const endY = ty + nodeH / 2;
    const midX = (startX + endX) / 2;
    return {
      path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
      labelX: midX,
      labelY: (startY + endY) / 2 - 10,
    };
  }

  const startX = sx + nodeW / 2;
  const startY = sy + nodeH;
  const endX = tx + nodeW / 2;
  const endY = ty;
  const midY = (startY + endY) / 2;
  return {
    path: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2 + 10,
    labelY: midY,
  };
}

function buildEdgePath(
  edge: { id: string; source: string; target: string },
  nodeMap: Map<string, ElkLayoutNode>,
  edgeMap: Map<string, ElkLayoutEdge>,
  nodeW: number,
  nodeH: number,
  dir: "RIGHT" | "DOWN",
): { path: string; labelX: number; labelY: number } {
  const sx = nodeMap.get(edge.source)?.x ?? 0;
  const sy = nodeMap.get(edge.source)?.y ?? 0;
  const tx = nodeMap.get(edge.target)?.x ?? 0;
  const ty = nodeMap.get(edge.target)?.y ?? 0;

  if (edge.source === edge.target) {
    const path = generateSelfLoopPath(sx, sy, nodeW, nodeH, dir);
    return { path, labelX: sx + nodeW + 20, labelY: sy };
  }

  const elkEdge = edgeMap.get(edge.id);
  if (elkEdge?.sections?.[0]) {
    const section = elkEdge.sections[0];
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const mid = points[Math.floor(points.length / 2)];
    return { path, labelX: mid.x, labelY: mid.y - 10 };
  }

  return generateEdgePath(sx, sy, tx, ty, nodeW, nodeH, dir);
}

export async function computeLayout(
  graph: ActorGraph,
  options?: LayoutOptions,
): Promise<LayoutResult> {
  const elk = await getElk();
  const elkLayout = await elk.layout(buildElkGraph(graph, options ?? {}));
  const nodeMap = new Map((elkLayout.children ?? []).map((n) => [n.id, n]));
  const edgeMap = new Map((elkLayout.edges ?? []).map((e) => [e.id, e]));

  const nodeW = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeH = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const dir = options?.direction ?? "RIGHT";

  const layoutNodes: LayoutNode[] = graph.nodes.map((node) => {
    const elkNode = nodeMap.get(node.id);
    return {
      id: node.id,
      x: elkNode?.x ?? 0,
      y: elkNode?.y ?? 0,
      width: nodeW,
      height: nodeH,
      label: node.label,
      isActive: node.isActive,
      isFinal: node.isFinal,
    };
  });

  const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
    const { path, labelX, labelY } = buildEdgePath(edge, nodeMap, edgeMap, nodeW, nodeH, dir);
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
    maxX = Math.max(maxX, node.x + nodeW);
    maxY = Math.max(maxY, node.y + nodeH);
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + DEFAULT_PADDING * 2,
    height: maxY + DEFAULT_PADDING * 2,
  };
}
