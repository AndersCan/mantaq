import type { Graph as X6Graph, Node, ComplexAttrValue } from "@antv/x6";
import type { ActorGraph, GraphNode } from "../graph.ts";
import { computeNodePositions } from "../layout.ts";
import type { LayoutOptions } from "../layout.ts";
import { nodeAttrs, nodeTooltip, badgeAttrs } from "./node-style.ts";
import { edgeConfig, edgeLine } from "./edge-style.ts";

const INITIAL_NODE_SIZE = 20;

interface GraphSyncState {
  highlightTimeout: ReturnType<typeof setTimeout> | undefined;
  disposed: boolean;
}

const graphStates = new WeakMap<X6Graph, GraphSyncState>();

function getGraphState(graph: X6Graph): GraphSyncState {
  let state = graphStates.get(graph);
  if (!state) {
    state = { highlightTimeout: undefined, disposed: false };
    graphStates.set(graph, state);
  }
  return state;
}

export function highlightTransition(graph: X6Graph, edgeId: string): void {
  const cell = graph.getCellById(edgeId);
  if (!cell?.isEdge()) return;

  const state = getGraphState(graph);

  if (state.highlightTimeout !== undefined) clearTimeout(state.highlightTimeout);

  if (!state.disposed) {
    graph.on(
      "dispose",
      () => {
        if (state.highlightTimeout !== undefined) clearTimeout(state.highlightTimeout);
        state.highlightTimeout = undefined;
        state.disposed = true;
      },
      { once: true },
    );
  }

  const originalStroke = cell.attr("line/stroke") as string;
  const originalStrokeWidth = cell.attr("line/strokeWidth") as number;

  cell.attr("line/stroke", "#22c55e");
  cell.attr("line/strokeWidth", 4);

  state.highlightTimeout = setTimeout(() => {
    state.highlightTimeout = undefined;
    if (state.disposed) return;
    cell.attr("line/stroke", originalStroke);
    cell.attr("line/strokeWidth", originalStrokeWidth);
  }, 600);
}

export interface SyncResult {
  structureChanged: boolean;
}

function createNode(
  graph: X6Graph,
  node: GraphNode,
  positions: Map<string, { x: number; y: number }>,
  movedPositions: Map<string, { x: number; y: number }>,
) {
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
    attrs: { ...nodeAttrs(node), ...badgeAttrs(node) },
    data: { tooltip: nodeTooltip(node) },
  });
}

function updateNode(
  node: GraphNode,
  cell: Node,
  positions: Map<string, { x: number; y: number }>,
  movedPositions: Map<string, { x: number; y: number }>,
) {
  const pos = movedPositions.get(node.id) ??
    positions.get(node.id) ?? { x: cell.getPosition().x, y: cell.getPosition().y };
  cell.setPosition(pos.x, pos.y);
  cell.setAttrs(nodeAttrs(node));
  cell.attr("label/text", node.label);
  const badge = badgeAttrs(node);
  cell.attr("badgeCircle/r", badge.badgeCircle.r);
  cell.attr("badgeCircle/fill", badge.badgeCircle.fill);
  cell.attr("badgeCircle/stroke", badge.badgeCircle.stroke);
  cell.attr("badgeText/text", badge.badgeText.text);
  cell.setData({ tooltip: nodeTooltip(node) }, { overwrite: true });
}

function syncDiff<T, C extends { id: string }>(
  items: T[],
  idOf: (item: T) => string,
  findCell: (id: string) => C | undefined,
  getCells: () => C[],
  handlers: {
    onCreate: (item: T) => void;
    onUpdate: (item: T, cell: C) => void;
    onRemove: (cellId: string) => void;
  },
): boolean {
  let changed = false;
  const ids = new Set(items.map(idOf));

  for (const item of items) {
    const cell = findCell(idOf(item));
    if (cell) {
      handlers.onUpdate(item, cell);
    } else {
      handlers.onCreate(item);
      changed = true;
    }
  }

  for (const cell of getCells()) {
    if (!ids.has(cell.id)) {
      handlers.onRemove(cell.id);
      changed = true;
    }
  }

  return changed;
}

export function syncNodes(
  graph: X6Graph,
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  movedPositions: Map<string, { x: number; y: number }>,
): boolean {
  return syncDiff(
    nodes,
    (n) => n.id,
    (id) => {
      const c = graph.getCellById(id);
      return c?.isNode() ? c : undefined;
    },
    () => graph.getNodes(),
    {
      onCreate: (node) => createNode(graph, node, positions, movedPositions),
      onUpdate: (node, cell) => updateNode(node, cell, positions, movedPositions),
      onRemove: (cellId) => graph.removeCell(cellId),
    },
  );
}

export function syncEdges(graph: X6Graph, edges: ActorGraph["edges"], routerName: string): boolean {
  return syncDiff(
    edges,
    (e) => e.id,
    (id) => {
      const cell = graph.getCellById(id);
      if (cell?.isEdge()) return cell;
      return undefined;
    },
    () => graph.getEdges(),
    {
      onCreate: (edge) => {
        graph.addEdge(edgeConfig(edge, routerName));
      },
      onUpdate: (edge, cell) => {
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
        cell.attr("line/style", (line.style ?? {}) as ComplexAttrValue);
      },
      onRemove: (cellId) => graph.removeCell(cellId),
    },
  );
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
