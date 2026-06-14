import type { Graph as X6Graph } from "@antv/x6";
import type { ActorGraph, GraphNode } from "../graph.ts";
import { computeNodePositions } from "../layout.ts";
import type { LayoutOptions } from "../layout.ts";
import { nodeAttrs, nodeTooltip, badgeAttrs } from "./node-style.ts";
import { edgeConfig, edgeLine } from "./edge-style.ts";

const INITIAL_NODE_SIZE = 20;

let highlightTimeout: ReturnType<typeof setTimeout> | undefined;
const disposedGraphs = new WeakSet<X6Graph>();

export function highlightTransition(graph: X6Graph, edgeId: string): void {
  const cell = graph.getCellById(edgeId);
  if (!cell?.isEdge()) return;

  if (highlightTimeout !== undefined) clearTimeout(highlightTimeout);

  if (!disposedGraphs.has(graph)) {
    graph.on(
      "dispose",
      () => {
        if (highlightTimeout !== undefined) clearTimeout(highlightTimeout);
        highlightTimeout = undefined;
        disposedGraphs.add(graph);
      },
      { once: true },
    );
  }

  const originalStroke = cell.attr("line/stroke") as string;
  const originalStrokeWidth = cell.attr("line/strokeWidth") as number;

  cell.attr("line/stroke", "#22c55e");
  cell.attr("line/strokeWidth", 4);

  highlightTimeout = setTimeout(() => {
    highlightTimeout = undefined;
    if (disposedGraphs.has(graph)) return;
    cell.attr("line/stroke", originalStroke);
    cell.attr("line/strokeWidth", originalStrokeWidth);
  }, 600);
}

export interface SyncResult {
  structureChanged: boolean;
}

export function syncNodes(
  graph: X6Graph,
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  movedPositions: Map<string, { x: number; y: number }>,
): boolean {
  let changed = false;
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    const cell = graph.getCellById(node.id);
    const tooltip = nodeTooltip(node);
    if (cell?.isNode()) {
      const pos = movedPositions.get(node.id) ??
        positions.get(node.id) ?? { x: cell.getPosition().x, y: cell.getPosition().y };
      cell.setPosition(pos.x, pos.y);
      cell.setAttrs(nodeAttrs(node) as never);
      cell.attr("label/text", node.label);
      const badge = badgeAttrs(node);
      const bc = badge.badgeCircle as { r: number; fill: string; stroke: string };
      const bt = badge.badgeText as { text: string };
      cell.attr("badgeCircle/r", bc.r);
      cell.attr("badgeCircle/fill", bc.fill);
      cell.attr("badgeCircle/stroke", bc.stroke);
      cell.attr("badgeText/text", bt.text);
      cell.setData({ tooltip }, { overwrite: true });
    } else {
      const pos = movedPositions.get(node.id) ?? positions.get(node.id) ?? { x: 0, y: 0 };
      const isInitial = node.isInitial;
      graph.addNode({
        id: node.id,
        shape: isInitial ? "circle" : "mantaq-state",
        x: pos.x,
        y: pos.y,
        width: isInitial ? INITIAL_NODE_SIZE : 160,
        height: isInitial ? INITIAL_NODE_SIZE : 60,
        label: isInitial ? "" : node.label,
        attrs: {
          ...nodeAttrs(node),
          ...badgeAttrs(node),
        } as never,
        data: { tooltip },
      } as never);
      changed = true;
    }
  }

  for (const cell of graph.getNodes()) {
    if (!nodeIds.has(cell.id)) {
      graph.removeCell(cell.id);
      changed = true;
    }
  }

  return changed;
}

export function syncEdges(graph: X6Graph, edges: ActorGraph["edges"], routerName: string): boolean {
  let changed = false;
  const edgeIds = new Set(edges.map((e) => e.id));

  for (const edge of edges) {
    const cell = graph.getCellById(edge.id);
    if (cell?.isEdge()) {
      const cfg = edgeConfig(edge, routerName);
      cell.setRouter({ name: routerName });
      if (cell.getSourceCellId() !== edge.source) cell.setSource({ cell: edge.source });
      if (cell.getTargetCellId() !== edge.target) cell.setTarget({ cell: edge.target });
      cell.setData(cfg.data);
      cell.setLabels(cfg.labels);
      const line = edgeLine(edge);
      cell.attr("line/stroke", line.stroke);
      cell.attr("line/strokeWidth", line.strokeWidth);
      cell.attr("line/strokeDasharray", line.strokeDasharray);
      cell.attr("line/strokeOpacity", line.strokeOpacity);
      cell.attr("line/targetMarker", line.targetMarker);
      cell.attr("line/cursor", line.cursor);
      (cell as { attr: (path: string, val: unknown) => void }).attr("line/style", line.style ?? {});
    } else {
      graph.addEdge(edgeConfig(edge, routerName));
      changed = true;
    }
  }

  for (const cell of graph.getEdges()) {
    if (!edgeIds.has(cell.id)) {
      graph.removeCell(cell.id);
      changed = true;
    }
  }

  return changed;
}

export function syncGraph(
  graph: X6Graph,
  actorGraph: ActorGraph,
  layoutOptions: LayoutOptions | undefined,
  movedPositions: Map<string, { x: number; y: number }>,
): SyncResult {
  const positions = computeNodePositions(actorGraph.nodes, actorGraph.edges, layoutOptions);
  const routerName = layoutOptions?.router ?? "normal";

  const nodesChanged = syncNodes(graph, actorGraph.nodes, positions, movedPositions);
  const edgesChanged = syncEdges(graph, actorGraph.edges, routerName);
  const structureChanged = nodesChanged || edgesChanged;

  if (structureChanged) {
    graph.zoomToFit({ padding: 40, maxScale: 1 });
  }

  return { structureChanged };
}
