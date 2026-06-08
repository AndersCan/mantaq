import type {
  ELK,
  ElkNode,
  ElkExtendedEdge,
  ElkEdgeSection,
  ElkPoint,
  LayoutOptions as ElkLayoutOptions,
} from "elkjs";
import type { ActorGraph, GraphNode, GraphEdge } from "./graph.ts";

export interface LayoutOptions {
  direction?: "RIGHT" | "DOWN";
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSpacing?: number;
  edgeSpacing?: number;
  padding?: { top: number; bottom: number; left: number; right: number };
}

export interface ComputedEdge extends GraphEdge {
  path: string | null;
  labelX: number;
  labelY: number;
}

export interface LayoutResult {
  nodes: GraphNode[];
  edges: ComputedEdge[];
  width: number;
  height: number;
}

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_NODE_SPACING = 30;
const DEFAULT_EDGE_SPACING = 20;
const DEFAULT_PADDING = { top: 20, bottom: 20, left: 20, right: 20 };
const BEZIER_OFFSET_RATIO = 0.5;
const SELF_LOOP_RADIUS = 40;
const SELF_LOOP_OFFSET = 20;

let elkInstance: ELK | null = null;

async function getElk(): Promise<ELK> {
  if (!elkInstance) {
    const mod = await import("elkjs");
    const ELKClass = mod.default ?? mod;
    elkInstance = new (ELKClass as unknown as new () => ELK)();
  }
  return elkInstance;
}

function flattenNodesForLayout(
  nodes: GraphNode[],
  nodeWidth: number,
  nodeHeight: number,
): GraphNode[] {
  const result: GraphNode[] = [];
  for (const node of nodes) {
    result.push({
      ...node,
      width: node.width ?? nodeWidth,
      height: node.height ?? nodeHeight,
    });
    if (node.children.length > 0) {
      result.push(...flattenNodesForLayout(node.children, nodeWidth, nodeHeight));
    }
  }
  return result;
}

function collectAllEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  const result: GraphEdge[] = [...edges];
  for (const node of nodes) {
    result.push(...collectAllEdges(node.children, []));
  }
  return result;
}

function nodesToElk(nodes: GraphNode[], nodeWidth: number, nodeHeight: number): ElkNode[] {
  return nodes.map((node) => {
    const elkChildren =
      node.children.length > 0 ? nodesToElk(node.children, nodeWidth, nodeHeight) : undefined;

    return {
      id: node.id,
      width: node.width ?? nodeWidth,
      height: node.height ?? nodeHeight,
      children: elkChildren,
    };
  });
}

function edgesToElk(graphEdges: GraphEdge[]): ElkExtendedEdge[] {
  return graphEdges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));
}

function elkNodeToMap(elkResult: ElkNode): Map<string, ElkNode> {
  const map = new Map<string, ElkNode>();
  function walk(node: ElkNode) {
    map.set(node.id, node);
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(elkResult);
  return map;
}

function sectionsToPath(section: ElkEdgeSection): string {
  const { startPoint, endPoint, bendPoints } = section;
  const points: ElkPoint[] = [startPoint, ...(bendPoints ?? []), endPoint];

  if (points.length === 2) {
    const [p1, p2] = points;
    const dx = p2.x - p1.x;
    const cx1 = p1.x + dx * BEZIER_OFFSET_RATIO;
    const cy1 = p1.y;
    const cx2 = p2.x - dx * BEZIER_OFFSET_RATIO;
    const cy2 = p2.y;
    return `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function bezierMidpoint(path: string): { x: number; y: number } {
  const cubicMatch = path.match(
    /M\s+([\d.]+)\s+([\d.]+)\s+C\s+([\d.]+)\s+([\d.]+),\s+([\d.]+)\s+([\d.]+),\s+([\d.]+)\s+([\d.]+)/,
  );
  if (cubicMatch) {
    const x1 = Number(cubicMatch[1]);
    const y1 = Number(cubicMatch[2]);
    const cx1 = Number(cubicMatch[3]);
    const cy1 = Number(cubicMatch[4]);
    const cx2 = Number(cubicMatch[5]);
    const cy2 = Number(cubicMatch[6]);
    const x2 = Number(cubicMatch[7]);
    const y2 = Number(cubicMatch[8]);
    const t = 0.5;
    const mt = 1 - t;
    const x = mt * mt * mt * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2;
    const y = mt * mt * mt * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2;
    return { x, y };
  }

  const lineMatch = path.match(/M\s+([\d.]+)\s+([\d.]+)/);
  if (lineMatch) {
    return { x: Number(lineMatch[1]), y: Number(lineMatch[2]) };
  }
  return { x: 0, y: 0 };
}

function selfLoopPath(x: number, y: number, width: number, height: number): string {
  const startX = x + width;
  const startY = y + height / 2;
  const loopX = x + width + SELF_LOOP_OFFSET;
  const loopTop = y - SELF_LOOP_RADIUS;
  const loopBottom = y + height + SELF_LOOP_RADIUS;
  return `M ${startX} ${startY} C ${loopX} ${loopTop}, ${loopX} ${loopBottom}, ${startX} ${startY}`;
}

function backwardEdgePath(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  tx: number,
  ty: number,
  tw: number,
  _th: number,
): string {
  const startX = sx + sw / 2;
  const startY = sy + sh;
  const endX = tx + tw / 2;
  const endY = ty;
  const midY = (startY + endY) / 2 + SELF_LOOP_OFFSET;
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

function computeEdgePath(
  sourceNode: ElkNode,
  targetNode: ElkNode,
  edge: ElkExtendedEdge,
): string | null {
  const sx = sourceNode.x ?? 0;
  const sy = sourceNode.y ?? 0;
  const sw = sourceNode.width ?? DEFAULT_NODE_WIDTH;
  const sh = sourceNode.height ?? DEFAULT_NODE_HEIGHT;
  const tx = targetNode.x ?? 0;
  const ty = targetNode.y ?? 0;
  const tw = targetNode.width ?? DEFAULT_NODE_WIDTH;
  const th = targetNode.height ?? DEFAULT_NODE_HEIGHT;

  if (edge.sources[0] === edge.targets[0]) {
    return selfLoopPath(sx, sy, sw, th);
  }

  if (edge.sections && edge.sections.length > 0) {
    return sectionsToPath(edge.sections[0]);
  }

  if (sx + sw <= tx) {
    const startX = sx + sw;
    const startY = sy + sh / 2;
    const endX = tx;
    const endY = ty + th / 2;
    const dx = endX - startX;
    const cx1 = startX + dx * BEZIER_OFFSET_RATIO;
    const cy1 = startY;
    const cx2 = endX - dx * BEZIER_OFFSET_RATIO;
    const cy2 = endY;
    return `M ${startX} ${startY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${endX} ${endY}`;
  }

  return backwardEdgePath(sx, sy, sw, sh, tx, ty, tw, th);
}

export function defaultPositions(
  nodes: GraphNode[],
  nodeWidth: number = DEFAULT_NODE_WIDTH,
  nodeHeight: number = DEFAULT_NODE_HEIGHT,
): GraphNode[] {
  if (nodes.length === 0) return [];

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const horizontalGap = nodeWidth + DEFAULT_NODE_SPACING;
  const verticalGap = nodeHeight + DEFAULT_NODE_SPACING;

  return nodes.map((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...node,
      x: col * horizontalGap,
      y: row * verticalGap,
      width: nodeWidth,
      height: nodeHeight,
    };
  });
}

export async function computeLayout(
  graph: ActorGraph,
  options?: LayoutOptions,
): Promise<LayoutResult> {
  const opts: Required<LayoutOptions> = {
    direction: options?.direction ?? "RIGHT",
    nodeWidth: options?.nodeWidth ?? DEFAULT_NODE_WIDTH,
    nodeHeight: options?.nodeHeight ?? DEFAULT_NODE_HEIGHT,
    nodeSpacing: options?.nodeSpacing ?? DEFAULT_NODE_SPACING,
    edgeSpacing: options?.edgeSpacing ?? DEFAULT_EDGE_SPACING,
    padding: options?.padding ?? DEFAULT_PADDING,
  };

  if (graph.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    };
  }

  const allNodes = flattenNodesForLayout(graph.nodes, opts.nodeWidth, opts.nodeHeight);
  const allEdges = collectAllEdges(graph.nodes, graph.edges);

  if (allNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    };
  }

  const elkNodes = nodesToElk(graph.nodes, opts.nodeWidth, opts.nodeHeight);
  const elkEdges = edgesToElk(allEdges);

  const elkGraph: ElkNode = {
    id: "__root__",
    children: elkNodes,
    edges: elkEdges,
  };

  const elkOptions: ElkLayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": opts.direction === "DOWN" ? "DOWN" : "RIGHT",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.considerModelOrder": "NODES_AND_EDGES",
    "elk.spacing.nodeNode": String(opts.nodeSpacing),
    "elk.spacing.edgeEdge": String(opts.edgeSpacing),
    "elk.padding": `${opts.padding.top};${opts.padding.right};${opts.padding.bottom};${opts.padding.left}`,
  };

  const elk = await getElk();
  const elkResult = await elk.layout(elkGraph, {
    layoutOptions: elkOptions,
  });

  const elkMap = elkNodeToMap(elkResult);

  const computedNodes: GraphNode[] = allNodes.map((node) => {
    const elkNode = elkMap.get(node.id);
    return {
      ...node,
      x: elkNode?.x ?? node.x ?? 0,
      y: elkNode?.y ?? node.y ?? 0,
      width: elkNode?.width ?? node.width ?? opts.nodeWidth,
      height: elkNode?.height ?? node.height ?? opts.nodeHeight,
    };
  });

  const computedEdges: ComputedEdge[] = allEdges.map((edge) => {
    const elkEdge = elkEdges.find((e) => e.id === edge.id);
    const sourceNode = elkMap.get(edge.source);
    const targetNode = elkMap.get(edge.target);

    let path: string;
    let labelX = 0;
    let labelY = 0;

    if (sourceNode && targetNode && elkEdge) {
      const computedPath = computeEdgePath(sourceNode, targetNode, elkEdge) ?? "";
      path = computedPath;

      if (path) {
        const mid = bezierMidpoint(path);
        labelX = mid.x;
        labelY = mid.y;
      }
    } else {
      path = "";
    }

    return {
      ...edge,
      path,
      labelX,
      labelY,
    };
  });

  let maxWidth = 0;
  let maxHeight = 0;
  for (const node of computedNodes) {
    const nodeRight = (node.x ?? 0) + (node.width ?? opts.nodeWidth);
    const nodeBottom = (node.y ?? 0) + (node.height ?? opts.nodeHeight);
    if (nodeRight > maxWidth) maxWidth = nodeRight;
    if (nodeBottom > maxHeight) maxHeight = nodeBottom;
  }

  return {
    nodes: computedNodes,
    edges: computedEdges,
    width: maxWidth + opts.padding.right,
    height: maxHeight + opts.padding.bottom,
  };
}
