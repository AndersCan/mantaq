import { isAnyState, scopeOf } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { edgeText } from "./labels.ts";
import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel, Point } from "@dagrejs/dagre";

export interface PlacedState {
  kind: "state";
  id: string;
  state: VizState;
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
  edge: VizEdge;
  /** Node id the edge ends at: a state id, or the unknown node id when `to` is null. */
  target: string;
  /** SVG path data. */
  path: string;
  label: Point;
  /** Gap between the dots of a dotted edge: grows with the edge so dots never merge into a line. */
  dotGap: number;
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
  /** Entry arrows: into the machine's start state, then into each region's, sorted by state id. */
  entries: Array<{ from: Point; to: Point }>;
}

const CHAR_WIDTH = 7;
const NODE_HEIGHT = 36;
const CHIP_ROW_HEIGHT = 20;
const LABEL_HEIGHT = 16;
const UNKNOWN_SIZE = 28;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export const MIN_EDGE_LENGTH = 72;
export const NODE_SEPARATION = 36;
const MIN_DOT_GAP = 3;
const MAX_DOT_GAP = 12;
const DOT_GAP_PER_LENGTH = 1 / 24;
const ANY_LABEL = "any state";

function anyIds(machine: VizMachine): string[] {
  return [...new Set(machine.edges.map((edge) => edge.from).filter(isAnyState))].sort();
}

function unknownNodeId(edge: VizEdge): string {
  return `?:${edge.id}`;
}

function regionNodeId(region: string): string {
  return `region:${region}`;
}

const HINT_WIDTH = 14;
/** Extra height of a map-child state: one row for its children's markers. */
const MARKER_ROW_HEIGHT = 20;
/** Narrowest map-child state: six two-character markers, their gaps and an inset. */
const MAP_STATE_MIN_WIDTH = 168;

function stateWidth(state: VizState): number {
  const chips = state.effects.map(
    (effect) => effect.name.length * CHAR_WIDTH + 24 + (effect.sends === null ? HINT_WIDTH : 0),
  );
  return Math.max(80, state.label.length * CHAR_WIDTH + 24, ...chips);
}

function stateHeight(state: VizState): number {
  return NODE_HEIGHT + state.effects.length * CHIP_ROW_HEIGHT;
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

function addStates(graph: LayoutGraph, machine: VizMachine): void {
  for (const state of machine.states) {
    const child = state.region !== null && machine.maps.includes(state.region);
    graph.setNode(state.id, {
      width: child ? Math.max(stateWidth(state), MAP_STATE_MIN_WIDTH) : stateWidth(state),
      height: stateHeight(state) + (child ? MARKER_ROW_HEIGHT : 0),
    });
    if (state.region !== null) graph.setParent(state.id, regionNodeId(state.region));
  }
}

function addAnyNodes(graph: LayoutGraph, machine: VizMachine): void {
  for (const id of anyIds(machine)) {
    graph.setNode(id, { width: ANY_LABEL.length * CHAR_WIDTH + 24, height: NODE_HEIGHT });
    const region = scopeOf(id);
    if (region !== "" && machine.regions.includes(region)) {
      graph.setParent(id, regionNodeId(region));
    }
  }
}

function addEdges(graph: LayoutGraph, machine: VizMachine): void {
  for (const edge of machine.edges) {
    if (edge.kind === "initial" || edge.kind === "effect" || edge.to === edge.from) continue;
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
  machine: VizMachine,
): Array<PlacedState | PlacedUnknown | PlacedAny> {
  const states: Array<PlacedState | PlacedUnknown | PlacedAny> = machine.states.map((state) => ({
    kind: "state",
    id: state.id,
    state,
    ...box(graph.node(state.id)),
  }));
  const unknowns: PlacedUnknown[] = machine.edges
    .filter((edge) => edge.kind !== "initial" && edge.kind !== "effect" && edge.to === null)
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

const LOOP_RISE = 24;
const LOOP_STEP = 56;
const LOOP_FOOT_STEP = 18;
const MIN_LOOP_MARGIN = 64;

/**
 * Self-loops nest above the node: each one wider and taller than the last,
 * with its own feet, its label just above its apex.
 */
function selfLoop(node: NodeLabel, nth: number, count: number): { path: string; label: Point } {
  const { x, y, width, height } = box(node);
  const top = y - height / 2;
  const rise = LOOP_RISE + nth * LOOP_STEP;
  // Feet spread over the room the node has, so arrowheads never share a spot.
  const footStep = Math.min(LOOP_FOOT_STEP, (width / 4 - 4) / Math.max(1, count - 1));
  const half = width / 4 + nth * footStep;
  const left = (x - half).toFixed(1);
  const right = (x + half).toFixed(1);
  const lift = (top - rise).toFixed(1);
  const base = top.toFixed(1);
  const path = `M${left},${base} C${left},${lift} ${right},${lift} ${right},${base}`;
  const apex = top - rise * 0.75;
  return { path, label: { x, y: apex - LABEL_HEIGHT / 2 - 2 } };
}

export function pathLength(points: ReadonlyArray<Point>): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

export function dotGapFor(length: number): number {
  return Math.min(MAX_DOT_GAP, Math.max(MIN_DOT_GAP, length * DOT_GAP_PER_LENGTH));
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_GAP = 2;

function collides(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + LABEL_GAP &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + LABEL_GAP
  );
}

/**
 * Moves each label vertically (0, +1, -1, +2, -2 steps) to the first spot that
 * clears every label placed before it. Pure and order-stable.
 */
export function separateLabels(boxes: ReadonlyArray<LabelBox>): LabelBox[] {
  const placed: LabelBox[] = [];
  for (const labelBox of boxes) {
    let candidate = labelBox;
    for (let step = 1; placed.some((other) => collides(candidate, other)); step++) {
      const shift = (LABEL_HEIGHT + LABEL_GAP) * Math.ceil(step / 2);
      candidate = { ...labelBox, y: labelBox.y + (step % 2 === 1 ? shift : -shift) };
    }
    placed.push(candidate);
  }
  return placed;
}

function avoidLabelCollisions(edges: PlacedEdge[]): PlacedEdge[] {
  const moved = separateLabels(
    edges.map((placed) => ({
      ...placed.label,
      width: edgeText(placed.edge).length * CHAR_WIDTH + 8,
      height: LABEL_HEIGHT,
    })),
  );
  return edges.map((placed, index) => ({
    ...placed,
    label: { x: placed.label.x, y: moved[index]?.y ?? placed.label.y },
  }));
}

function loopCounts(machine: VizMachine): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of machine.edges) {
    if (edge.kind === "initial" || edge.kind === "effect" || edge.to !== edge.from) continue;
    counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
  }
  return counts;
}

/** Room above the top rank so the outermost loop's label stays inside the view. */
function loopHeadroom(machine: VizMachine): number {
  const most = Math.max(0, ...loopCounts(machine).values());
  const outerRise = LOOP_RISE + (most - 1) * LOOP_STEP;
  return Math.max(MIN_LOOP_MARGIN, Math.ceil(outerRise * 0.75 + LABEL_HEIGHT + 6));
}

function placeEdges(graph: LayoutGraph, machine: VizMachine): PlacedEdge[] {
  const counts = loopCounts(machine);
  const loopsSeen = new Map<string, number>();
  return machine.edges
    .filter((edge) => edge.kind !== "initial" && edge.kind !== "effect")
    .map((edge) => {
      if (edge.to === edge.from) {
        const nth = loopsSeen.get(edge.from) ?? 0;
        loopsSeen.set(edge.from, nth + 1);
        return {
          edge,
          target: edge.from,
          dotGap: dotGapFor(MIN_EDGE_LENGTH),
          ...selfLoop(graph.node(edge.from), nth, counts.get(edge.from) ?? 1),
        };
      }
      const target = edge.to ?? unknownNodeId(edge);
      const label = graph.edge(edge.from, target, edge.id);
      return {
        edge,
        target,
        path: polyline(label.points ?? []),
        label: { x: label.x ?? 0, y: label.y ?? 0 },
        dotGap: dotGapFor(pathLength(label.points ?? [])),
      };
    });
}

function placeEntries(graph: LayoutGraph, machine: VizMachine): MachineLayout["entries"] {
  const regionStarts = machine.states
    .filter((state) => state.initial && state.region !== null)
    .map((state) => state.id)
    .sort();
  const starts = machine.initial === null ? regionStarts : [machine.initial, ...regionStarts];
  return starts.map((id) => {
    const node = box(graph.node(id));
    const left = node.x - node.width / 2;
    return { from: { x: left - 28, y: node.y }, to: { x: left, y: node.y } };
  });
}

/**
 * Layered layout (dagre, left to right). Pure: same machine in, same
 * coordinates out. The initial edge is drawn as an entry arrow, not a graph edge.
 */
export function layoutMachine(machine: VizMachine): MachineLayout {
  const graph: LayoutGraph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
    compound: true,
  });
  graph.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEPARATION,
    ranksep: MIN_EDGE_LENGTH,
    edgesep: 14,
    marginx: 48,
    // Room above the top rank for hand-drawn self-loops.
    marginy: loopHeadroom(machine),
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
    edges: avoidLabelCollisions(placeEdges(graph, machine)),
    regions: machine.regions.map((region) => ({
      region,
      ...box(graph.node(regionNodeId(region))),
    })),
    entries: placeEntries(graph, machine),
  };
}
