import type { ActorGraph } from "./graph.ts";
import type { ELK, ElkNode as ElkApiNode, ElkExtendedEdge } from "elkjs";

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
  algorithm?: "layered" | "force" | "stress" | "mrtree";
  edgeRouting?: "orthogonal" | "spline" | "polyline";
  autoSize?: boolean;
}

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_PADDING = 40;

interface ElkGraph extends ElkApiNode {
  layoutOptions: Record<string, string>;
  children: ElkApiNode[];
  edges: ElkExtendedEdge[];
}

let elkInstance: ELK | null = null;
let cachedLayoutKey = "";
let cachedLayoutResult: LayoutResult | null = null;

export function invalidateLayoutCache(): void {
  cachedLayoutKey = "";
  cachedLayoutResult = null;
}

async function getElk(): Promise<ELK> {
  if (elkInstance) return elkInstance;
  const mod = await import("elkjs");
  const ELKConstructor = mod.default as unknown as new () => ELK;
  const instance = new ELKConstructor();
  elkInstance = instance;
  return instance;
}

const ALGORITHM_OPTIONS: Record<string, Record<string, string>> = {
  layered: {
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "60",
    "elk.layered.considerModelOrder": "true",
  },
  force: {
    "elk.force.iterations": "300",
    "elk.force.repulsivePower": "2",
    "elk.force.springLength": "100",
    "elk.spacing.nodeNode": "60",
  },
  stress: {
    "elk.stress.iterations": "300",
    "elk.spacing.nodeNode": "60",
  },
  mrtree: {
    "elk.spacing.nodeNode": "60",
    "elk.mrtree.searchOrder": "DFS",
  },
};

const EDGE_ROUTING_MAP: Record<string, string> = {
  orthogonal: "ORTHOGONAL",
  spline: "SPLINES",
  polyline: "POLYLINE",
};

function calcNodeWidth(label: string, baseWidth: number): number {
  const charWidth = 8;
  const padding = 32;
  const minWidth = baseWidth;
  const maxWidth = baseWidth * 2;
  const estimated = label.length * charWidth + padding;
  return Math.min(maxWidth, Math.max(minWidth, estimated));
}

function buildElkGraph(graph: ActorGraph, options: LayoutOptions): ElkGraph {
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const direction = options.direction ?? "RIGHT";
  const algorithm = options.algorithm ?? "layered";
  const edgeRouting = options.edgeRouting ?? "orthogonal";
  const autoSize = options.autoSize ?? false;

  const algoOpts = ALGORITHM_OPTIONS[algorithm] ?? ALGORITHM_OPTIONS.layered;

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": algorithm,
      "elk.direction": direction,
      "elk.padding": `[top=${DEFAULT_PADDING},left=${DEFAULT_PADDING},bottom=${DEFAULT_PADDING},right=${DEFAULT_PADDING}]`,
      ...algoOpts,
      ...options.elkOptions,
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: autoSize ? calcNodeWidth(node.label, nodeWidth) : nodeWidth,
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
        "edge.edgeRouting": EDGE_ROUTING_MAP[edgeRouting] ?? "ORTHOGONAL",
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
  nodeMap: Map<string, ElkApiNode>,
  edgeMap: Map<string, ElkExtendedEdge>,
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
  if (!graph) {
    throw new Error("Cannot compute layout: graph is null or undefined");
  }
  if (!Array.isArray(graph.nodes)) {
    throw new Error("Cannot compute layout: graph.nodes is not an array");
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error("Cannot compute layout: graph.edges is not an array");
  }
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  if (graph.nodes.length === 1) {
    const node = graph.nodes[0];
    const nodeW = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
    const nodeH = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;
    const dir = options?.direction ?? "RIGHT";
    const selfLoops = graph.edges.filter((e) => e.source === node.id && e.target === node.id);
    const layoutEdges: LayoutEdge[] = selfLoops.map((edge) => {
      const path = generateSelfLoopPath(DEFAULT_PADDING, DEFAULT_PADDING, nodeW, nodeH, dir);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        isActive: edge.isActive,
        path,
        labelX: DEFAULT_PADDING + nodeW + 20,
        labelY: DEFAULT_PADDING,
      };
    });
    return {
      nodes: [
        {
          id: node.id,
          x: DEFAULT_PADDING,
          y: DEFAULT_PADDING,
          width: nodeW,
          height: nodeH,
          label: node.label,
          isActive: node.isActive,
          isFinal: node.isFinal,
        },
      ],
      edges: layoutEdges,
      width: nodeW + DEFAULT_PADDING * 2,
      height: nodeH + DEFAULT_PADDING * 2,
    };
  }

  const nodeW = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeH = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const dir = options?.direction ?? "RIGHT";

  const optKey = `${options?.nodeWidth ?? DEFAULT_NODE_WIDTH}|${options?.nodeHeight ?? DEFAULT_NODE_HEIGHT}|${options?.direction ?? "RIGHT"}|${options?.algorithm ?? "layered"}|${options?.edgeRouting ?? "orthogonal"}|${options?.autoSize ?? false}`;
  const structureKey =
    graph.nodes.map((n) => n.id).join(",") +
    "|" +
    graph.edges.map((e) => e.id).join(",") +
    "|" +
    optKey;
  if (cachedLayoutResult && cachedLayoutKey === structureKey) {
    const result = cachedLayoutResult;
    return {
      ...result,
      nodes: result.nodes.map((n) => {
        const gNode = graph.nodes.find((gn) => gn.id === n.id);
        return gNode ? { ...n, isActive: gNode.isActive, isFinal: gNode.isFinal } : n;
      }),
      edges: result.edges.map((e) => {
        const gEdge = graph.edges.find((ge) => ge.id === e.id);
        return gEdge ? { ...e, isActive: gEdge.isActive } : e;
      }),
    };
  }

  const elk = await getElk();
  let elkLayout: ElkApiNode | undefined;
  const MAX_RETRIES = 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      elkLayout = await elk.layout(buildElkGraph(graph, options ?? {}));
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
      }
    }
  }
  if (lastError || !elkLayout) {
    throw new Error(
      `ELK layout failed after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
    );
  }

  const nodeMap = new Map((elkLayout.children ?? []).map((n: ElkApiNode) => [n.id, n]));
  const edgeMap = new Map((elkLayout.edges ?? []).map((e: ElkExtendedEdge) => [e.id, e]));

  const autoSize = options?.autoSize ?? false;

  const layoutNodes: LayoutNode[] = graph.nodes.map((node) => {
    const elkNode = nodeMap.get(node.id);
    return {
      id: node.id,
      x: elkNode?.x ?? 0,
      y: elkNode?.y ?? 0,
      width: autoSize ? (elkNode?.width ?? nodeW) : nodeW,
      height: autoSize ? (elkNode?.height ?? nodeH) : nodeH,
      label: node.label,
      isActive: node.isActive,
      isFinal: node.isFinal,
    };
  });

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const validEdges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const layoutEdges: LayoutEdge[] = validEdges.map((edge) => {
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

  const result: LayoutResult = {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + DEFAULT_PADDING * 2,
    height: maxY + DEFAULT_PADDING * 2,
  };
  cachedLayoutKey = structureKey;
  cachedLayoutResult = result;
  return result;
}
