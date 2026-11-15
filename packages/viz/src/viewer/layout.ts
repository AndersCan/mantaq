import { isAnyState, scopeOf } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { edgeLines } from "./labels.ts";
import { labelOverlapsFor, overlapsOf } from "./overlaps.ts";
import type { Overlap } from "./overlaps.ts";
import { Either } from "@mantaq/utils";
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
  /** The same route as points: a polyline, self-loops included. */
  points: Point[];
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
  /** The title's own box: the first row inside the region. */
  title: LabelBox;
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
export const LABEL_PAD = 8;
const CONDITION_FONT = 10.2;
const CHIP_FONT = 11;
const NODE_HEIGHT = 36;
const CHIP_ROW_HEIGHT = 20;
const LABEL_HEIGHT = 16;
/** Label to its own arrow, and to any other arrow: strictly farther, so the nearest arrow is always its own. */
export const LABEL_OWN = 8;
export const LABEL_FOREIGN = 14;
export const PORT_GAP = 10;
export const STUB = 12;
export const ENTRY_LENGTH = 28;
const ENTRY_STUB = 42;
export const LOOP_BASE = 16;
export const LEG_GAP = 10;
export const LEG_INSET = 16;
export const LOOP_FIRST_SPAN = 24;
const TITLE_HEIGHT = 16;
/** A state's finding mark sticks out this far above and right of its box. */
const MARK_OVERHANG = 6;
/** The row a region reserves above its content for its title. */
const TITLE_ROW = LABEL_PAD + TITLE_HEIGHT + LABEL_PAD;
const UNKNOWN_SIZE = 28;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export const MIN_EDGE_LENGTH = 72;
export const NODE_SEPARATION = 36;
/** Room between ranks: wide enough that arrows into one state fan out gently and labels fit beside them. */
const RANK_SEPARATION = 140;
const MARGIN_X = 48;
const MARGIN_Y = 32;
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

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
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

function isDrawn(edge: VizEdge): boolean {
  return edge.kind !== "initial" && edge.kind !== "effect";
}

function isLoop(edge: VizEdge): boolean {
  return edge.to === edge.from;
}

function targetOf(edge: VizEdge): string {
  return edge.to ?? unknownNodeId(edge);
}

/** One self-loop: `span` wide, its bar `rise` above the box top, its label above the bar. */
interface Loop {
  edge: VizEdge;
  size: { width: number; height: number };
  span: number;
  rise: number;
}

/**
 * Nested rectangles above a node: each loop is `2 * LEG_GAP` wider than the
 * one inside it and wide enough that the inner label clears its legs.
 */
function loopsOf(edges: ReadonlyArray<VizEdge>): Loop[] {
  const loops: Loop[] = [];
  let before: Loop | undefined;
  for (const edge of edges) {
    const size = labelSize(edge);
    const loop: Loop =
      before === undefined
        ? { edge, size, span: LOOP_FIRST_SPAN, rise: LOOP_BASE }
        : {
            edge,
            size,
            span: Math.max(before.span + 2 * LEG_GAP, before.size.width + 2 * LABEL_FOREIGN),
            rise: before.rise + LABEL_OWN + before.size.height + LABEL_FOREIGN,
          };
    loops.push(loop);
    before = loop;
  }
  return loops;
}

/** What dagre is given for a node: the box, the loops above it and the entry arrow's room on its left. */
interface Spec {
  id: string;
  width: number;
  height: number;
  loops: Loop[];
  /** Room above the box. */
  stack: number;
  /** Footprint width without the entry room. */
  inner: number;
  entry: number;
}

function specOf(
  id: string,
  size: { width: number; height: number },
  loops: Loop[],
  entry: number,
): Spec {
  const last = loops.at(-1);
  const width = Math.max(size.width, last === undefined ? 0 : last.span + 2 * LEG_INSET);
  return {
    id,
    width,
    height: size.height,
    loops,
    stack: last === undefined ? 0 : last.rise + LABEL_OWN + last.size.height + LABEL_PAD,
    inner: Math.max(width, last === undefined ? 0 : last.size.width + 2 * LABEL_PAD),
    entry,
  };
}

function startIds(machine: VizMachine): string[] {
  const regionStarts = machine.states
    .filter((state) => state.initial && state.region !== null)
    .map((state) => state.id)
    .sort();
  return machine.initial === null ? regionStarts : [machine.initial, ...regionStarts];
}

/** `heights` raises a node's box to the room its ports need. */
function specsOf(machine: VizMachine, heights: ReadonlyMap<string, number>): Map<string, Spec> {
  const starts = new Set(startIds(machine));
  const specs = new Map<string, Spec>();
  const tall = (id: string, height: number): number => Math.max(height, heights.get(id) ?? 0);
  for (const state of machine.states) {
    const loops = loopsOf(
      machine.edges.filter((edge) => isDrawn(edge) && isLoop(edge) && edge.from === state.id),
    );
    const size = { width: stateWidth(state), height: tall(state.id, stateHeight(state)) };
    specs.set(state.id, specOf(state.id, size, loops, starts.has(state.id) ? ENTRY_STUB : 0));
  }
  for (const id of anyIds(machine)) {
    const size = { width: textWidth(ANY_LABEL) + 24, height: tall(id, NODE_HEIGHT) };
    specs.set(id, specOf(id, size, [], 0));
  }
  for (const edge of machine.edges) {
    if (!isDrawn(edge) || edge.to !== null) continue;
    const size = { width: UNKNOWN_SIZE, height: UNKNOWN_SIZE };
    specs.set(unknownNodeId(edge), specOf(unknownNodeId(edge), size, [], 0));
  }
  return specs;
}

/** The state, `*` or unknown node's region, or null at the top. */
function ownersOf(machine: VizMachine): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const state of machine.states) owners.set(state.id, state.region);
  for (const id of anyIds(machine)) {
    const region = scopeOf(id);
    owners.set(id, region !== "" && machine.regions.includes(region) ? region : null);
  }
  for (const edge of machine.edges) {
    if (isDrawn(edge) && edge.to === null)
      owners.set(unknownNodeId(edge), owners.get(edge.from) ?? null);
  }
  return owners;
}

function graphOf(machine: VizMachine, specs: ReadonlyMap<string, Spec>): LayoutGraph {
  const graph: LayoutGraph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
    compound: true,
  });
  graph.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    edgesep: 14 + 3 * LABEL_PAD,
    marginx: MARGIN_X,
    marginy: MARGIN_Y,
  });
  for (const region of machine.regions)
    graph.setNode(regionNodeId(region), { width: 0, height: 0 });
  for (const region of machine.regions) {
    const parent = parentRegion(region);
    if (parent !== null && machine.regions.includes(parent)) {
      graph.setParent(regionNodeId(region), regionNodeId(parent));
    }
  }
  const owners = ownersOf(machine);
  for (const [id, spec] of specs) {
    graph.setNode(id, { width: spec.entry + spec.inner, height: spec.stack + spec.height });
    const owner = owners.get(id) ?? null;
    if (owner !== null) graph.setParent(id, regionNodeId(owner));
  }
  for (const edge of machine.edges) {
    if (!isDrawn(edge) || isLoop(edge)) continue;
    const label: EdgeLabel = { ...labelSize(edge), labelpos: "r", labeloffset: LABEL_PAD };
    graph.setEdge(edge.from, targetOf(edge), label, edge.id);
  }
  return graph;
}

interface Sides {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function sidesOf(box: LabelBox): Sides {
  return {
    left: box.x - box.width / 2,
    right: box.x + box.width / 2,
    top: box.y - box.height / 2,
    bottom: box.y + box.height / 2,
  };
}

function mergeSides(all: ReadonlyArray<Sides>): Sides | null {
  const first = all[0];
  if (first === undefined) return null;
  return all.reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  }));
}

/** Everything dagre placed, as plain numbers that region fitting may shift. */
interface Geo {
  /** Node footprint centres. */
  nodes: Map<string, Point>;
  /** Label centres of the arrows dagre routed. */
  labels: Map<string, Point>;
  routes: Map<string, Point[]>;
  regions: Map<string, Sides>;
  width: number;
  height: number;
}

function routesOf(
  graph: LayoutGraph,
  machine: VizMachine,
): { labels: Map<string, Point>; routes: Map<string, Point[]> } {
  const labels = new Map<string, Point>();
  const routes = new Map<string, Point[]>();
  for (const edge of machine.edges) {
    if (!isDrawn(edge) || isLoop(edge)) continue;
    const placed = graph.edge(edge.from, targetOf(edge), edge.id);
    labels.set(edge.id, { x: placed.x ?? 0, y: placed.y ?? 0 });
    routes.set(
      edge.id,
      (placed.points ?? []).map((point: Point) => ({ x: point.x, y: point.y })),
    );
  }
  return { labels, routes };
}

function geoOf(graph: LayoutGraph, machine: VizMachine, specs: ReadonlyMap<string, Spec>): Geo {
  const nodes = new Map<string, Point>();
  for (const id of specs.keys()) {
    const node = graph.node(id);
    nodes.set(id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
  const regions = new Map<string, Sides>();
  for (const region of machine.regions) {
    regions.set(region, sidesOf(box(graph.node(regionNodeId(region)))));
  }
  const size = graph.graph();
  return {
    nodes,
    ...routesOf(graph, machine),
    regions,
    width: size.width ?? 0,
    height: size.height ?? 0,
  };
}

function box(label: NodeLabel): LabelBox {
  return { x: label.x ?? 0, y: label.y ?? 0, width: label.width, height: label.height };
}

/** Moves everything past `above` on one axis by `by`: space is only ever inserted, never removed. */
function insertSpace(geo: Geo, axis: "x" | "y", above: number, by: number): void {
  if (by <= 0) return;
  const move = (value: number): number => (value > above ? value + by : value);
  const points = [
    ...geo.nodes.values(),
    ...geo.labels.values(),
    ...[...geo.routes.values()].flat(),
  ];
  for (const point of points) point[axis] = move(point[axis]);
  for (const sides of geo.regions.values()) {
    if (axis === "y") {
      sides.top = move(sides.top);
      sides.bottom = move(sides.bottom);
    } else {
      sides.left = move(sides.left);
      sides.right = move(sides.right);
    }
  }
  if (axis === "y") geo.height = move(geo.height);
  else geo.width = move(geo.width);
}

function within(region: string, owner: string | null | undefined): boolean {
  return (
    owner !== undefined && owner !== null && (owner === region || owner.startsWith(`${region}.`))
  );
}

function regionTitle(machine: VizMachine, region: string): string {
  return machine.maps.includes(region) ? `${region}: one per key` : region;
}

interface Context {
  machine: VizMachine;
  specs: ReadonlyMap<string, Spec>;
  owners: ReadonlyMap<string, string | null>;
}

/** Bounds of a region's members: nodes with their loops and entry room, labels, child regions. */
function contentOf(region: string, geo: Geo, context: Context): Sides | null {
  const found: Sides[] = [];
  for (const [id, centre] of geo.nodes) {
    const spec = context.specs.get(id);
    if (spec === undefined || !within(region, context.owners.get(id))) continue;
    const sides = sidesOf({
      ...centre,
      width: spec.entry + spec.inner,
      height: spec.stack + spec.height,
    });
    found.push({ ...sides, top: sides.top - MARK_OVERHANG, right: sides.right + MARK_OVERHANG });
  }
  for (const edge of context.machine.edges) {
    const centre = geo.labels.get(edge.id);
    const ends = [edge.from, targetOf(edge)];
    if (centre === undefined || !ends.every((id) => within(region, context.owners.get(id))))
      continue;
    found.push(sidesOf({ ...centre, ...labelSize(edge) }));
  }
  for (const [other, sides] of geo.regions) {
    if (other.startsWith(`${region}.`)) found.push(sides);
  }
  return mergeSides(found);
}

function contentOrPoint(region: string, geo: Geo, context: Context): Sides {
  const own = geo.regions.get(region);
  const centre =
    own === undefined
      ? { x: 0, y: 0 }
      : { x: (own.left + own.right) / 2, y: (own.top + own.bottom) / 2 };
  return (
    contentOf(region, geo, context) ?? {
      left: centre.x,
      right: centre.x,
      top: centre.y,
      bottom: centre.y,
    }
  );
}

/**
 * Fits a region's box to its members with a title row on top, inserting space
 * for whatever the box grew past dagre's border. Deepest regions run first.
 */
function fitRegion(region: string, geo: Geo, context: Context): void {
  const dagreBox = geo.regions.get(region);
  if (dagreBox === undefined) return;
  const tw = textWidth(regionTitle(context.machine, region)) + 8;
  const fit = (): Sides => {
    const c = contentOrPoint(region, geo, context);
    const left = c.left - LABEL_PAD;
    return {
      left,
      right: Math.max(c.right + LABEL_PAD, left + tw + 2 * LABEL_PAD),
      top: c.top - TITLE_ROW,
      bottom: c.bottom + LABEL_PAD,
    };
  };
  insertSpace(geo, "y", dagreBox.top, dagreBox.top - fit().top);
  insertSpace(geo, "y", dagreBox.bottom, fit().bottom - dagreBox.bottom);
  insertSpace(geo, "x", dagreBox.left, dagreBox.left - fit().left);
  insertSpace(geo, "x", dagreBox.right, fit().right - dagreBox.right);
  geo.regions.set(region, fit());
}

function titleOf(sides: Sides, tw: number): LabelBox {
  return {
    x: sides.left + LABEL_PAD + tw / 2,
    y: sides.top + LABEL_PAD + TITLE_HEIGHT / 2,
    width: tw,
    height: TITLE_HEIGHT,
  };
}

/** A node's box inside its footprint: at the bottom, and right of the entry room. */
function boxOf(spec: Spec, centre: Point): LabelBox {
  return {
    x: centre.x + spec.entry / 2,
    y: centre.y + spec.stack / 2,
    width: spec.width,
    height: spec.height,
  };
}

interface End {
  edge: string;
  first: boolean;
  node: string;
  /** The route point the end faces. */
  via: Point;
}

function endsOf(machine: VizMachine, routes: ReadonlyMap<string, Point[]>): End[] {
  const ends: End[] = [];
  for (const edge of machine.edges) {
    const route = routes.get(edge.id);
    if (route === undefined || route.length === 0) continue;
    const near = route.length > 2;
    const start = near ? route[1] : route.at(-1);
    const finish = near ? route.at(-2) : route[0];
    if (start === undefined || finish === undefined) continue;
    ends.push(
      { edge: edge.id, first: true, node: edge.from, via: start },
      { edge: edge.id, first: false, node: targetOf(edge), via: finish },
    );
  }
  return ends;
}

interface Port {
  x: number;
  y: number;
  /** -1 on a node's left side, 1 on its right. */
  side: -1 | 1;
}

interface Ports {
  ports: Map<string, Port>;
  /** Height of the slots each node needs. */
  need: Map<string, number>;
  entryY: Map<string, number>;
}

function portKey(edge: string, first: boolean): string {
  return `${edge}|${first ? "from" : "to"}`;
}

function sideOf(end: End, boxes: ReadonlyMap<string, LabelBox>): -1 | 1 {
  return end.via.x < (boxes.get(end.node)?.x ?? 0) ? -1 : 1;
}

interface Group {
  node: string;
  side: -1 | 1;
  ends: End[];
}

function groupEnds(ends: ReadonlyArray<End>, boxes: ReadonlyMap<string, LabelBox>): Group[] {
  const groups = new Map<string, Group>();
  for (const end of ends) {
    const side = sideOf(end, boxes);
    const key = `${end.node}|${side}`;
    const group = groups.get(key) ?? { node: end.node, side, ends: [] };
    group.ends.push(end);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Spaces one side's ends `PORT_GAP` apart around the box middle; the entry takes the middle slot. */
function placeSide(
  group: ReadonlyArray<End>,
  side: { at: LabelBox; side: -1 | 1; entry: boolean },
): { ports: Map<string, Port>; slots: number; entryY: number } {
  const sorted = [...group].sort((a, b) => a.via.y - b.via.y || a.edge.localeCompare(b.edge));
  const slots = sorted.length + (side.entry ? 1 : 0);
  const entryAt = Math.floor(sorted.length / 2);
  const slotY = (slot: number): number => side.at.y + (slot - (slots - 1) / 2) * PORT_GAP;
  const ports = new Map<string, Port>();
  for (const [index, end] of sorted.entries()) {
    const slot = side.entry && index >= entryAt ? index + 1 : index;
    ports.set(portKey(end.edge, end.first), {
      x: side.at.x + (side.side * side.at.width) / 2,
      y: slotY(slot),
      side: side.side,
    });
  }
  return { ports, slots, entryY: slotY(entryAt) };
}

/**
 * Ends attach to the left or right side of their node, whichever faces the
 * route, sorted by height and spaced `PORT_GAP` apart around the box middle.
 * A start state's entry arrow takes the middle slot of its left side.
 */
function assignPorts(
  ends: ReadonlyArray<End>,
  boxes: ReadonlyMap<string, LabelBox>,
  starts: ReadonlySet<string>,
): Ports {
  const groups = groupEnds(ends, boxes);
  const ports = new Map<string, Port>();
  const need = new Map<string, number>();
  const entryY = new Map<string, number>();
  for (const id of starts) entryY.set(id, boxes.get(id)?.y ?? 0);
  for (const group of groups) {
    const at = boxes.get(group.node);
    if (at === undefined) continue;
    const entry = group.side === -1 && starts.has(group.node);
    const placed = placeSide(group.ends, { at, side: group.side, entry });
    for (const [portName, port] of placed.ports) ports.set(portName, port);
    if (entry) entryY.set(group.node, placed.entryY);
    need.set(group.node, Math.max(need.get(group.node) ?? 0, PORT_GAP * (placed.slots + 1)));
  }
  return { ports, need, entryY };
}

/** In edge order, moves a label to the first spot that clears everything already settled. */
function settleLabels(base: MachineLayout): PlacedEdge[] {
  const edges = [...base.edges];
  const unsettled = new Set(edges.map((placed) => `label:${placed.edge.id}`));
  for (const [index, placed] of edges.entries()) {
    unsettled.delete(`label:${placed.edge.id}`);
    if (isLoop(placed.edge)) continue;
    for (const spot of labelSpots(placed, placed.points)) {
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

/** Runs dagre until every node's box is tall enough for its ports (at most 3 passes). */
function laidOut(machine: VizMachine): { graph: LayoutGraph; specs: Map<string, Spec>; geo: Geo } {
  const starts = new Set(startIds(machine));
  const heights = new Map<string, number>();
  for (let pass = 0; ; pass++) {
    const specs = specsOf(machine, heights);
    const graph = graphOf(machine, specs);
    layout(graph);
    const geo = geoOf(graph, machine, specs);
    const boxes = new Map(
      [...specs].map(([id, spec]) => [id, boxOf(spec, geo.nodes.get(id) ?? { x: 0, y: 0 })]),
    );
    const { need } = assignPorts(endsOf(machine, geo.routes), boxes, starts);
    const grown = [...need].filter(([id, height]) => height > (specs.get(id)?.height ?? 0));
    if (grown.length === 0 || pass === 2) return { graph, specs, geo };
    for (const [id, height] of grown) heights.set(id, height);
  }
}

function placedOf(edge: VizEdge, points: Point[], centre: Point, dotLength: number): PlacedEdge {
  return {
    edge,
    target: targetOf(edge),
    path: polyline(points),
    points,
    dotGap: dotGapFor(dotLength),
    ...boxed(edge, centre),
  };
}

function loopPlaced(edge: VizEdge, loop: Loop, at: LabelBox): PlacedEdge {
  const top = at.y - at.height / 2;
  const left = at.x - loop.span / 2;
  const right = at.x + loop.span / 2;
  const bar = top - loop.rise;
  const points = [
    { x: left, y: top },
    { x: left, y: bar },
    { x: right, y: bar },
    { x: right, y: top },
  ];
  const centre = { x: at.x, y: bar - LABEL_OWN - loop.size.height / 2 };
  return placedOf(edge, points, centre, MIN_EDGE_LENGTH);
}

/**
 * Layered layout (dagre, left to right). Pure: same machine in, same
 * coordinates out. The initial edge is drawn as an entry arrow, not a graph edge.
 * Unchecked: `layoutMachine` is the one that refuses an overlapping result.
 */
export function placeMachine(machine: VizMachine): MachineLayout {
  const { specs, geo } = laidOut(machine);
  const context: Context = { machine, specs, owners: ownersOf(machine) };
  const regions = [...machine.regions].sort(
    (a, b) => b.split(".").length - a.split(".").length || a.localeCompare(b),
  );
  for (const region of regions) fitRegion(region, geo, context);
  const boxes = new Map<string, LabelBox>();
  for (const [id, spec] of specs) boxes.set(id, boxOf(spec, geo.nodes.get(id) ?? { x: 0, y: 0 }));
  const starts = startIds(machine);
  const { ports, entryY } = assignPorts(endsOf(machine, geo.routes), boxes, new Set(starts));
  const nodes = placeNodes(machine, specs, boxes);
  const edges = machine.edges.filter(isDrawn).map((edge) => {
    if (isLoop(edge)) {
      const at = boxes.get(edge.from);
      const loop = specs.get(edge.from)?.loops.find((each) => each.edge === edge);
      if (at !== undefined && loop !== undefined) return loopPlaced(edge, loop, at);
    }
    const route = geo.routes.get(edge.id) ?? [];
    const points = portRoute(edge, route, ports, new Set(starts));
    return placedOf(edge, points, geo.labels.get(edge.id) ?? { x: 0, y: 0 }, pathLength(points));
  });
  const placed: MachineLayout = {
    width: geo.width,
    height: geo.height,
    nodes,
    edges,
    regions: regions
      .map((region) => {
        const sides = geo.regions.get(region) ?? { left: 0, right: 0, top: 0, bottom: 0 };
        const tw = textWidth(regionTitle(machine, region)) + 8;
        return {
          region,
          x: (sides.left + sides.right) / 2,
          y: (sides.top + sides.bottom) / 2,
          width: sides.right - sides.left,
          height: sides.bottom - sides.top,
          title: titleOf(sides, tw),
        };
      })
      .sort((a, b) => machine.regions.indexOf(a.region) - machine.regions.indexOf(b.region)),
    entries: starts.map((id) => {
      const at = boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
      const left = at.x - at.width / 2;
      const y = entryY.get(id) ?? at.y;
      return { from: { x: left - ENTRY_LENGTH, y }, to: { x: left, y } };
    }),
  };
  return { ...placed, edges: settleLabels(placed) };
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

export function polyline(points: ReadonlyArray<Point>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function boxed(edge: VizEdge, centre: Point): Pick<PlacedEdge, "label" | "text"> {
  const size = labelSize(edge);
  const shift = edge.kind === "transition" ? LOCK_SLOT / 2 : 0;
  return {
    label: { x: centre.x, y: centre.y, ...size },
    text: { x: centre.x + shift, y: centre.y },
  };
}

function placeNodes(
  machine: VizMachine,
  specs: ReadonlyMap<string, Spec>,
  boxes: ReadonlyMap<string, LabelBox>,
): Array<PlacedState | PlacedUnknown | PlacedAny> {
  const at = (id: string): LabelBox => boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
  const states: Array<PlacedState | PlacedUnknown | PlacedAny> = machine.states.map((state) => ({
    kind: "state",
    id: state.id,
    state,
    ...at(state.id),
  }));
  const anys: PlacedAny[] = anyIds(machine).map((id) => ({ kind: "any", id, ...at(id) }));
  const unknowns: PlacedUnknown[] = machine.edges
    .filter((edge) => isDrawn(edge) && edge.to === null && specs.has(unknownNodeId(edge)))
    .map((edge) => ({
      kind: "unknown",
      id: unknownNodeId(edge),
      edgeId: edge.id,
      ...at(unknownNodeId(edge)),
    }));
  return [...states, ...anys, ...unknowns];
}

/** The route with its ends moved to ports on the box sides, each leaving by a stub. */
function portRoute(
  edge: VizEdge,
  route: ReadonlyArray<Point>,
  ports: ReadonlyMap<string, Port>,
  starts: ReadonlySet<string>,
): Point[] {
  const first = ports.get(portKey(edge.id, true));
  const last = ports.get(portKey(edge.id, false));
  if (first === undefined || last === undefined) return [...route];
  const stub = (port: Port, node: string): number =>
    port.side * (port.side === -1 && starts.has(node) ? ENTRY_STUB : STUB);
  return [
    { x: first.x, y: first.y },
    { x: first.x + stub(first, edge.from), y: first.y },
    ...route.slice(1, -1),
    { x: last.x + stub(last, targetOf(edge)), y: last.y },
    { x: last.x, y: last.y },
  ];
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

/** The layout, or the overlaps it still has: a diagram that covers itself is never returned. */
export function layoutMachine(machine: VizMachine): Either<Overlap[], MachineLayout> {
  const placed = placeMachine(machine);
  const overlaps = overlapsOf(placed);
  return overlaps.length === 0 ? Either.right(placed) : Either.left(overlaps);
}
