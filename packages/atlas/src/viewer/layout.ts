import { isAnyState, scopeOf } from "../schema.ts";
import type { AtlasEdge, AtlasMachine, AtlasState } from "../schema.ts";
import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel, Point } from "@dagrejs/dagre";

export interface PlacedState {
  kind: "state";
  id: string;
  state: AtlasState;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Placeholder target for an undetermined edge. One per edge; never shared or guessed. */
export interface PlacedUnknown {
  kind: "unknown";
  id: string;
  edgeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The `*` source of `onAny` edges: one per machine or region that registers `onAny`. */
export interface PlacedAny {
  kind: "any";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedEdge {
  edge: AtlasEdge;
  /** Node id the edge ends at: a state id, or the unknown node id when `to` is null. */
  target: string;
  /** SVG path data. */
  path: string;
  label: Point;
}

export interface PlacedRegion {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MachineLayout {
  width: number;
  height: number;
  nodes: Array<PlacedState | PlacedUnknown | PlacedAny>;
  edges: PlacedEdge[];
  regions: PlacedRegion[];
  /** Entry arrow into the initial state, from the `initial` edge. */
  entry: { from: Point; to: Point } | null;
}

const CHAR_WIDTH = 7;
const NODE_HEIGHT = 36;
const LABEL_HEIGHT = 16;
const UNKNOWN_SIZE = 28;
const ANY_LABEL = "any state";

function anyIds(machine: AtlasMachine): string[] {
  return [...new Set(machine.edges.map((edge) => edge.from).filter(isAnyState))].sort();
}

function unknownNodeId(edge: AtlasEdge): string {
  return `?:${edge.id}`;
}

function regionNodeId(region: string): string {
  return `region:${region}`;
}

function edgeText(edge: AtlasEdge): string {
  return edge.kind === "effect" ? "effect" : edge.event;
}

function stateWidth(state: AtlasState): number {
  return Math.max(80, state.label.length * CHAR_WIDTH + 24);
}

function parentRegion(region: string): string | null {
  const cut = region.lastIndexOf(".");
  return cut === -1 ? null : region.slice(0, cut);
}

type LayoutGraph = Graph<GraphLabel, NodeLabel, EdgeLabel>;

function addRegions(graph: LayoutGraph, regions: ReadonlyArray<string>): void {
  for (const region of regions) graph.setNode(regionNodeId(region), { width: 0, height: 0 });
  for (const region of regions) {
    const parent = parentRegion(region);
    if (parent !== null && regions.includes(parent)) {
      graph.setParent(regionNodeId(region), regionNodeId(parent));
    }
  }
}

function addStates(graph: LayoutGraph, machine: AtlasMachine): void {
  for (const state of machine.states) {
    graph.setNode(state.id, { width: stateWidth(state), height: NODE_HEIGHT });
    if (state.region !== null) graph.setParent(state.id, regionNodeId(state.region));
  }
}

function addAnyNodes(graph: LayoutGraph, machine: AtlasMachine): void {
  for (const id of anyIds(machine)) {
    graph.setNode(id, { width: ANY_LABEL.length * CHAR_WIDTH + 24, height: NODE_HEIGHT });
    const region = scopeOf(id);
    if (region !== "" && machine.regions.includes(region)) {
      graph.setParent(id, regionNodeId(region));
    }
  }
}

function addEdges(graph: LayoutGraph, machine: AtlasMachine): void {
  for (const edge of machine.edges) {
    if (edge.kind === "initial" || edge.to === edge.from) continue;
    const target = edge.to ?? unknownNodeId(edge);
    if (edge.to === null) {
      graph.setNode(target, { width: UNKNOWN_SIZE, height: UNKNOWN_SIZE });
      const region = machine.states.find((state) => state.id === edge.from)?.region ?? null;
      if (region !== null) graph.setParent(target, regionNodeId(region));
    }
    const label: EdgeLabel = {
      width: edgeText(edge).length * CHAR_WIDTH + 8,
      height: LABEL_HEIGHT,
      labelpos: "c",
    };
    graph.setEdge(edge.from, target, label, edge.id);
  }
}

function box(label: NodeLabel): { x: number; y: number; width: number; height: number } {
  return { x: label.x ?? 0, y: label.y ?? 0, width: label.width, height: label.height };
}

function placeNodes(
  graph: LayoutGraph,
  machine: AtlasMachine,
): Array<PlacedState | PlacedUnknown | PlacedAny> {
  const states: Array<PlacedState | PlacedUnknown | PlacedAny> = machine.states.map((state) => ({
    kind: "state",
    id: state.id,
    state,
    ...box(graph.node(state.id)),
  }));
  const unknowns: PlacedUnknown[] = machine.edges
    .filter((edge) => edge.kind !== "initial" && edge.to === null)
    .map((edge) => ({
      kind: "unknown",
      id: unknownNodeId(edge),
      edgeId: edge.id,
      ...box(graph.node(unknownNodeId(edge))),
    }));
  const anys: PlacedAny[] = anyIds(machine).map((id) => ({
    kind: "any",
    id,
    ...box(graph.node(id)),
  }));
  return [...states, ...anys, ...unknowns];
}

function polyline(points: ReadonlyArray<Point>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

/**
 * Self-loops are drawn by hand above the node: dagre routes them as a flat
 * line. The nth loop on a node is taller, so several loops stay readable.
 */
function selfLoop(node: NodeLabel, nth: number): { path: string; label: Point } {
  const { x, y, width, height } = box(node);
  const top = y - height / 2;
  const rise = 26 + nth * 18;
  const spread = width / 2;
  const path = `M${(x - width / 4).toFixed(1)},${top.toFixed(1)} C${(x - spread).toFixed(1)},${(top - rise).toFixed(1)} ${(x + spread).toFixed(1)},${(top - rise).toFixed(1)} ${(x + width / 4).toFixed(1)},${top.toFixed(1)}`;
  return { path, label: { x, y: top - rise * 0.75 - 4 } };
}

function placeEdges(graph: LayoutGraph, machine: AtlasMachine): PlacedEdge[] {
  const loopsSeen = new Map<string, number>();
  return machine.edges
    .filter((edge) => edge.kind !== "initial")
    .map((edge) => {
      if (edge.to === edge.from) {
        const nth = loopsSeen.get(edge.from) ?? 0;
        loopsSeen.set(edge.from, nth + 1);
        return { edge, target: edge.from, ...selfLoop(graph.node(edge.from), nth) };
      }
      const target = edge.to ?? unknownNodeId(edge);
      const label = graph.edge(edge.from, target, edge.id);
      return {
        edge,
        target,
        path: polyline(label.points ?? []),
        label: { x: label.x ?? 0, y: label.y ?? 0 },
      };
    });
}

function placeEntry(graph: LayoutGraph, machine: AtlasMachine): MachineLayout["entry"] {
  if (machine.initial === null) return null;
  const node = box(graph.node(machine.initial));
  const left = node.x - node.width / 2;
  return { from: { x: left - 28, y: node.y }, to: { x: left, y: node.y } };
}

/**
 * Layered layout (dagre, left to right). Pure: same machine in, same
 * coordinates out. The initial edge is drawn as an entry arrow, not a graph edge.
 */
export function layoutMachine(machine: AtlasMachine): MachineLayout {
  const graph: LayoutGraph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
    compound: true,
  });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 28,
    ranksep: 64,
    edgesep: 14,
    marginx: 48,
    // Room above the top rank for hand-drawn self-loops.
    marginy: 64,
  });
  addRegions(graph, machine.regions);
  addStates(graph, machine);
  addAnyNodes(graph, machine);
  addEdges(graph, machine);
  layout(graph);
  const size = graph.graph();
  return {
    width: size.width ?? 0,
    height: size.height ?? 0,
    nodes: placeNodes(graph, machine),
    edges: placeEdges(graph, machine),
    regions: machine.regions.map((region) => ({
      region,
      ...box(graph.node(regionNodeId(region))),
    })),
    entry: placeEntry(graph, machine),
  };
}
