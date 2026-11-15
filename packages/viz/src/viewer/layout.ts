import { isAnyState, scopeOf } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { edgeLines } from "./labels.ts";
import { labelOverlapsFor } from "./overlaps.ts";
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
  /** The reserved label box (centre and size); includes the lock slot on its left for transitions. */
  label: LabelBox;
  /** Centre of the text lines: the label centre, shifted right by half the lock slot for transitions. */
  text: Point;
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

const WIDTH_TABLE: ReadonlyArray<readonly [number, string]> = [
  [3.5, "i "],
  [4, "!',.:;jl"],
  [4.5, "[]f"],
  [5, "()/t|"],
  [5.5, "-Ir"],
  [6, "\\{}"],
  [6.5, "z"],
  [7, '"Jaksv'],
  [7.5, "12356789$*+<=>?^_`cehnouxy~"],
  [8, "04Fbdgpq"],
  [8.5, "ELPSTZ"],
  [9, "#ABCDRUVXY"],
  [9.5, "GHKNOQ"],
  [10, "&"],
  [10.5, "w"],
  [11, "m"],
  [11.5, "M"],
  [12, "%W"],
  [12.5, "@"],
];
const ADVANCES = new Map(
  WIDTH_TABLE.flatMap(([advance, chars]) => [...chars].map((c) => [c, advance] as const)),
);
const UNLISTED_ADVANCE = 15;

/**
 * Width in px of `text`: the widest advance of the fonts the viewer may use,
 * per character (measured at 12px), scaled to `fontSize`, with 5% slack.
 */
export function textWidth(text: string, fontSize = 12): number {
  let sum = 0;
  for (const char of text) sum += ADVANCES.get(char) ?? UNLISTED_ADVANCE;
  return Math.ceil(((sum * fontSize) / 12) * 1.05);
}

/** Room left of a transition's label for its lock. */
export const LOCK_SLOT = 12;
const LABEL_PAD = 8;
const CONDITION_FONT = 10.2;
const CHIP_FONT = 11;
const NODE_HEIGHT = 36;
const CHIP_ROW_HEIGHT = 20;
const LABEL_HEIGHT = 16;
const UNKNOWN_SIZE = 28;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export const MIN_EDGE_LENGTH = 72;
export const NODE_SEPARATION = 36;
/** Room between ranks: wide enough that arrows into one state fan out gently and labels fit beside them. */
const RANK_SEPARATION = 100;
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

function stateWidth(state: VizState): number {
  const chips = state.effects.map(
    (effect) => textWidth(effect.name, CHIP_FONT) + 24 + (effect.sends === null ? HINT_WIDTH : 0),
  );
  return Math.max(80, textWidth(state.label) + 24, ...chips);
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
    graph.setNode(state.id, { width: stateWidth(state), height: stateHeight(state) });
    if (state.region !== null) graph.setParent(state.id, regionNodeId(state.region));
  }
}

function addAnyNodes(graph: LayoutGraph, machine: VizMachine): void {
  for (const id of anyIds(machine)) {
    graph.setNode(id, { width: textWidth(ANY_LABEL) + 24, height: NODE_HEIGHT });
    const region = scopeOf(id);
    if (region !== "" && machine.regions.includes(region)) {
      graph.setParent(id, regionNodeId(region));
    }
  }
}

function labelSize(edge: VizEdge): { width: number; height: number } {
  const lines = edgeLines(edge);
  const widest = Math.max(
    ...lines.map((line, index) => textWidth(line, index === 0 ? 12 : CONDITION_FONT)),
  );
  return {
    width: widest + 8 + (edge.kind === "transition" ? LOCK_SLOT : 0),
    height: LABEL_HEIGHT * lines.length,
  };
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
      ...labelSize(edge),
      labelpos: "r",
      labeloffset: LABEL_PAD,
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

export function polyline(points: ReadonlyArray<Point>): string {
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

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
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

function boxed(edge: VizEdge, centre: Point): Pick<PlacedEdge, "label" | "text"> {
  const size = labelSize(edge);
  const shift = edge.kind === "transition" ? LOCK_SLOT / 2 : 0;
  return {
    label: { x: centre.x, y: centre.y, ...size },
    text: { x: centre.x + shift, y: centre.y },
  };
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
        const loop = selfLoop(graph.node(edge.from), nth, counts.get(edge.from) ?? 1);
        return {
          edge,
          target: edge.from,
          dotGap: dotGapFor(MIN_EDGE_LENGTH),
          path: loop.path,
          ...boxed(edge, loop.label),
        };
      }
      const target = edge.to ?? unknownNodeId(edge);
      const label = graph.edge(edge.from, target, edge.id);
      return {
        edge,
        target,
        path: polyline(label.points ?? []),
        ...boxed(edge, { x: label.x ?? 0, y: label.y ?? 0 }),
        dotGap: dotGapFor(pathLength(label.points ?? [])),
      };
    });
}

const MAX_SLOPE = 3;

/** Highest and lowest y of the arrow between two x values, and its steepest |dy/dx| there (capped). */
function arrowSpan(
  points: ReadonlyArray<Point>,
  from: number,
  to: number,
): { top: number; bottom: number; slope: number } {
  const ys: number[] = [];
  let slope = 0;
  for (const [index, end] of points.entries()) {
    const start = points[index - 1];
    if (start === undefined) continue;
    const dx = end.x - start.x;
    if (Math.abs(dx) < 1 || Math.max(start.x, end.x) < from || Math.min(start.x, end.x) > to)
      continue;
    const at = (x: number): number => start.y + ((end.y - start.y) * (x - start.x)) / dx;
    const low = Math.max(from, Math.min(start.x, end.x));
    const high = Math.min(to, Math.max(start.x, end.x));
    ys.push(at(low), at(high));
    slope = Math.max(slope, Math.abs((end.y - start.y) / dx));
  }
  return { top: Math.min(...ys), bottom: Math.max(...ys), slope: Math.min(slope, MAX_SLOPE) };
}

/** Points along the arrow, bends and quarter marks of each segment, ordered from its middle outwards. */
function anchors(points: ReadonlyArray<Point>): Point[] {
  const found: Array<{ point: Point; along: number }> = [];
  const total = pathLength(points);
  let walked = 0;
  for (const [index, end] of points.entries()) {
    const start = points[index - 1];
    if (start === undefined) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    for (const part of [0.25, 0.5, 0.75]) {
      found.push({
        point: { x: start.x + (end.x - start.x) * part, y: start.y + (end.y - start.y) * part },
        along: walked + length * part,
      });
    }
    walked += length;
    if (index < points.length - 1) found.push({ point: end, along: walked });
  }
  return found
    .sort((a, b) => Math.abs(a.along - total / 2) - Math.abs(b.along - total / 2))
    .map(({ point }) => point);
}

/**
 * Candidate centres for a label, best first: dagre's spot, its mirror above
 * the arrow, then beside points along the arrow, middle outwards.
 */
export function labelSpots(placed: PlacedEdge, points: ReadonlyArray<Point>): Point[] {
  const { x, y, width, height } = placed.label;
  const spots: Point[] = [
    { x, y },
    { x, y: y - 2 * (height / 2 + LABEL_PAD) },
  ];
  for (const point of anchors(points)) {
    const span = arrowSpan(points, point.x - width / 2, point.x + width / 2);
    const away = height / 2 + 1 + LABEL_PAD * Math.hypot(1, span.slope);
    if (span.top > span.bottom) continue;
    spots.push({ x: point.x, y: span.bottom + away }, { x: point.x, y: span.top - away });
  }
  return spots;
}

/** In edge order, moves a label to the first spot that clears everything already settled. */
function settleLabels(base: MachineLayout, graph: LayoutGraph): PlacedEdge[] {
  const edges = [...base.edges];
  const unsettled = new Set(edges.map((placed) => `label:${placed.edge.id}`));
  for (const [index, placed] of edges.entries()) {
    unsettled.delete(`label:${placed.edge.id}`);
    if (placed.edge.from === placed.edge.to) continue;
    const points = graph.edge(placed.edge.from, placed.target, placed.edge.id)?.points ?? [];
    for (const spot of labelSpots(placed, points)) {
      const moved = { ...placed, ...boxed(placed.edge, spot) };
      const trial = { ...base, edges: edges.map((each, at) => (at === index ? moved : each)) };
      const clash = labelOverlapsFor(trial, placed.edge.id).some(
        (overlap) => !unsettled.has(overlap.a) && !unsettled.has(overlap.b),
      );
      if (clash) continue;
      edges[index] = moved;
      break;
    }
  }
  return edges;
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
    ranksep: RANK_SEPARATION,
    edgesep: 14 + 3 * LABEL_PAD,
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
  const placed: MachineLayout = {
    width: size.width ?? 0,
    height: size.height ?? 0,
    nodes: placeNodes(graph, machine),
    edges: placeEdges(graph, machine),
    regions: machine.regions.map((region) => ({
      region,
      ...box(graph.node(regionNodeId(region))),
    })),
    entries: placeEntries(graph, machine),
  };
  return { ...placed, edges: settleLabels(placed, graph) };
}
