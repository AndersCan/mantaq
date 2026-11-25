import { isAnyState, scopeOf } from "../schema.ts";
import { isNever } from "../is-never.ts";
import type { VizEdge, VizFuzzMessage, VizMachine, VizState } from "../schema.ts";
import { edgeLines } from "./labels.ts";
import { ARROW_SIZE, FINAL_INSET, LABEL_PAD, PATH_GAP } from "./geometry.ts";
import { overlapsOf } from "./overlaps.ts";
import { hasQueue } from "./queue.ts";
import { localName } from "./compartments.ts";
import { isSharedNode, shareArrows } from "./shared.ts";
import type { Shared } from "./shared.ts";
import type { Overlap } from "./overlaps.ts";
import { groupNodeAt, realMachineOf } from "./groups/fold-groups.ts";
import { realMembersOf } from "./groups/acting-member.ts";
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
  /** The state's name: centred, `LABEL_PAD` inside the box and clear of the chips. */
  label: LabelBox;
  /** One box per effect, top to bottom, under the name. */
  chips: LabelBox[];
  /** Actor-map states: the row live worker chips sit in, `LABEL_PAD` under the name and effect chips. */
  workers?: LabelBox;
}

/** What a group node stands for: the group's name and the real states it folds into one node. */
export interface Holds {
  group: string;
  states: string[];
  /** The states of `states` that are final: the walk can end there. */
  finals: string[];
}

/** A group drawn as one node: a row under its name for a glyph, its size or the state the walk is in, and its enter control. Its states are never drawn here. */
export interface PlacedMachine extends Omit<PlacedState, "kind"> {
  kind: "machine";
  holds: Holds;
  glyph: LabelBox;
  /** The row's text: how many states the group holds, or the one the walk is in; wide enough for each. */
  name: LabelBox;
  enter: LabelBox;
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
  /** `any state`, or the first source states of a shared arrow. */
  label: string;
  /** The drawn states a shared node stands for, a group by its node; empty for an `onAny` node. */
  states: string[];
  /** The real states it stands for, a group node by its states, so the walk marks it current. */
  walked: string[];
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
  /** Ids of the real edges a shared or group arrow stands for; absent when it is one edge. */
  members?: string[];
  /** How many drawn states a shared arrow leaves, as its node counts them; absent for any other arrow. */
  sources?: number;
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

/** A message line: no label, never clicked. */
export interface PlacedMessage {
  from: string;
  to: string;
  path: string;
  points: Point[];
  dotGap: number;
}

export type PlacedNode = PlacedState | PlacedMachine | PlacedUnknown | PlacedAny;

/** The way the ranks run: left to right, or top to bottom for a canvas too narrow for that. */
export type Flow = "across" | "down";

export interface MachineLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  messages: PlacedMessage[];
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
/** Room right of a label's first line for its `?`. */
export const HELP_SLOT = 12;
const CONDITION_FONT = 10.2;
const CHIP_FONT = 11;
const NODE_HEIGHT = 36;
const CHIP_HEIGHT = 16;
const LABEL_HEIGHT = 16;
/** A state name's box: tall enough for the docs font's glyphs (16.25), which edge labels never need. */
const NAME_HEIGHT = 18;
const MACHINE_ROW_HEIGHT = 16;
const MACHINE_GLYPH = 12;
/** Text of a group node's enter control. */
export const ENTER_TEXT = "enter";
const ENTER_WIDTH = textWidth(ENTER_TEXT, CHIP_FONT) + 12;
/** Label to its own arrow, and to any other arrow: strictly farther, so the nearest arrow is always its own. */
export const LABEL_OWN = 8;
export const LABEL_FOREIGN = 14;
export const PORT_GAP = ARROW_SIZE + LABEL_PAD;
export const STUB = 12;
export const ENTRY_LENGTH = 28;
const ENTRY_STUB = 42;
export const LOOP_BASE = 16;
export const LEG_GAP = 2 * LABEL_PAD;
export const LEG_INSET = 16;
export const LOOP_FIRST_SPAN = 24;
const TITLE_HEIGHT = 16;
/** A state's finding mark sticks out this far above and right of its box. */
const MARK_OVERHANG = 6;
/** Room between a level run and its label, and between a column's widest item and the sloped part of a path: one more than `LABEL_PAD` so float error never trips the checker. */
const LEVEL_CLEAR = LABEL_PAD + 1;
/** Two level pieces closer than this in y would run into each other if their lanes were in the wrong order. */
const LANE_ROW_CLASH = PATH_GAP;
const LANE_TITLE_CLEAR = 5;
/** The row a region reserves above its content for its title. */
const TITLE_ROW = LABEL_PAD + TITLE_HEIGHT + LABEL_PAD;
const UNKNOWN_SIZE = 28;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export const MIN_EDGE_LENGTH = 72;
export const NODE_SEPARATION = 24;
/** Room between ranks: wide enough that arrows into one state fan out gently and labels fit beside them. */
const RANK_SEPARATION = 70;
const MARGIN_X = 48;
const MARGIN_Y = 32;
const MIN_DOT_GAP = 3;
const MAX_DOT_GAP = 12;
const DOT_GAP_PER_LENGTH = 1 / 24;
const ANY_LABEL = "any state";

/** A machine with the shared arrows already swapped in for the edges they stand for. */
interface Drawing extends VizMachine {
  shared: Shared;
  /** The group nodes by state id. */
  holds: ReadonlyMap<string, Holds>;
  /** The real edges a drawn arrow stands for, by its id; absent when it is its own one edge. */
  members: ReadonlyMap<string, string[]>;
  flow: Flow;
}

function anyIds(machine: VizMachine): string[] {
  const from = machine.edges.map((edge) => edge.from);
  return [...new Set(from.filter((id) => isAnyState(id) || isSharedNode(id)))].sort();
}

function anyLabel(machine: Drawing, id: string): string {
  return machine.shared.nodes.find((node) => node.id === id)?.label ?? ANY_LABEL;
}

interface SourcesQuery {
  /** A shared node's id. */
  node: string;
}

/** The drawn states a shared node stands for; empty for an `onAny` node. */
function sourcesOf(machine: Drawing, options: SourcesQuery): string[] {
  return machine.shared.nodes.find((node) => node.id === options.node)?.states ?? [];
}

function unknownNodeId(edge: VizEdge): string {
  return `?:${edge.id}`;
}

function regionNodeId(region: string): string {
  return `region:${region}`;
}

const WORKER_ROW_HEIGHT = 14;
const MAP_STATE_MIN_WIDTH = 168;

function hasRow(machine: VizMachine, state: VizState): boolean {
  if (state.region !== null) return machine.maps.includes(state.region);
  return hasQueue(machine);
}

/** What a group node of the drawn machine holds; undefined for a plain state. */
function holdsOf(machine: VizMachine, state: VizState): Holds | undefined {
  const node = groupNodeAt(machine, { node: state.id });
  if (node === undefined) return undefined;
  const finals: string[] = [];
  for (const real of realMachineOf(machine).states) {
    if (real.final && node.states.includes(real.id)) finals.push(real.id);
  }
  return { group: node.name, states: node.states, finals };
}

/** The text of a group node's row while the walk is elsewhere: the group's size. */
export function rowText(holds: Holds): string {
  const count = holds.states.length;
  return count === 1 ? "1 state" : `${count} states`;
}

/** How the walk is in a state of a group: still going, or ended in a final state. */
export type WalkInside = "going" | "ended";

export interface CurrentRowOptions {
  walk: WalkInside;
}

/** The text of a group node's row while the walk is in `state`, one of its states. */
export function currentRowText(state: string, options: CurrentRowOptions): string {
  const name = localName(state);
  return options.walk === "ended" ? `ended in ${name}` : `now in ${name}`;
}

/** The widest text the row can show: the size, or any state the walk can be in. */
function rowTextWidth(holds: Holds): number {
  let widest = textWidth(rowText(holds), CHIP_FONT);
  for (const state of holds.states) {
    const walk = holds.finals.includes(state) ? "ended" : "going";
    const text = currentRowText(state, { walk });
    widest = Math.max(widest, textWidth(text, CHIP_FONT));
  }
  return widest;
}

/** Glyph, the row's text and the enter control, `LABEL_PAD` apart. */
function machineRowWidth(holds: Holds): number {
  return MACHINE_GLYPH + LABEL_PAD + rowTextWidth(holds) + LABEL_PAD + ENTER_WIDTH;
}

/** Height a group node's row adds under the name; 0 for a plain state. */
function machineRoom(holds: Holds | undefined): number {
  return holds === undefined ? 0 : LABEL_PAD + MACHINE_ROW_HEIGHT;
}

/** What shapes a state's box besides the state: its worker row, and what it holds as a group node. */
interface StateShape {
  worker: boolean;
  holds: Holds | undefined;
}

function stateWidth(state: VizState, shape: StateShape): number {
  const { worker, holds } = shape;
  const chips = state.effects.map((effect) => textWidth(effect.name, CHIP_FONT) + 24);
  const frame = state.final ? 2 * FINAL_INSET : 0;
  const row = holds === undefined ? 0 : machineRowWidth(holds) + 24;
  return Math.max(
    worker ? MAP_STATE_MIN_WIDTH : 80,
    textWidth(state.label) + 24 + frame,
    row + frame,
    ...chips.map((chip) => chip + frame),
  );
}

function stateHeight(state: VizState, shape: StateShape): number {
  const { worker, holds } = shape;
  const frame = state.final ? 2 * FINAL_INSET : 0;
  return (
    frame +
    Math.max(
      NODE_HEIGHT,
      2 * LABEL_PAD +
        NAME_HEIGHT +
        machineRoom(holds) +
        state.effects.length * (LABEL_PAD + CHIP_HEIGHT),
    ) +
    (worker ? LABEL_PAD + WORKER_ROW_HEIGHT : 0)
  );
}

/** The name box and chip boxes of a placed state, each `LABEL_PAD` inside and apart. */
function insideOf(
  state: VizState,
  spot: NodeSpot,
): { label: LabelBox; chips: LabelBox[]; workers?: LabelBox } {
  const { box: area, worker, holds } = spot;
  const frame = state.final ? FINAL_INSET : 0;
  const top = area.y - area.height / 2 + frame;
  const alone = state.effects.length === 0 && !worker && holds === undefined;
  const label = {
    x: area.x,
    y: alone ? area.y : top + LABEL_PAD + NAME_HEIGHT / 2,
    width: textWidth(state.label),
    height: NAME_HEIGHT,
  };
  const below = top + 2 * LABEL_PAD + NAME_HEIGHT + machineRoom(holds);
  const chips = state.effects.map((_, index) => ({
    x: area.x,
    y: below + index * (LABEL_PAD + CHIP_HEIGHT) + CHIP_HEIGHT / 2,
    width: area.width - 2 * (LABEL_PAD + frame),
    height: CHIP_HEIGHT,
  }));
  if (!worker) return { label, chips };
  const above = chips.at(-1);
  const bottom = above === undefined ? below - LABEL_PAD : above.y + above.height / 2;
  const workers = {
    x: area.x,
    y: bottom + LABEL_PAD + WORKER_ROW_HEIGHT / 2,
    width: area.width - 2 * (LABEL_PAD + frame),
    height: WORKER_ROW_HEIGHT,
  };
  return { label, chips, workers };
}

function parentRegion(region: string): string | null {
  const cut = region.lastIndexOf(".");
  return cut === -1 ? null : region.slice(0, cut);
}

type LayoutGraph = Graph<GraphLabel, NodeLabel, EdgeLabel>;

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Messages fuzzing saw one machine send another: one line per (from, to) and per (from, event, receiving machine), in document order. */
export function messagesOf(machine: VizMachine): VizFuzzMessage[] {
  const found: VizFuzzMessage[] = [];
  const seen = new Set<string>();
  for (const message of machine.fuzz?.messages ?? []) {
    const pair = `${message.from}>${message.to}`;
    const delivery = `${message.from}|${message.event}|${scopeOf(message.to)}`;
    if (seen.has(pair) || seen.has(delivery)) continue;
    seen.add(pair);
    seen.add(delivery);
    found.push(message);
  }
  return found;
}

function messageEdge(message: VizFuzzMessage): VizEdge {
  return {
    id: `message:${message.from}>${message.to}`,
    from: message.from,
    to: message.to,
    event: message.event,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function isMessage(edge: VizEdge): boolean {
  return edge.id.startsWith("message:");
}

function labelSize(edge: VizEdge): { width: number; height: number } {
  if (isMessage(edge)) return { width: 0, height: 0 };
  const lines = edgeLines(edge);
  const widest = Math.max(
    ...lines.map((line, index) => textWidth(line, index === 0 ? 12 : CONDITION_FONT)),
  );
  return {
    width: widest + 8 + HELP_SLOT + (edge.kind === "transition" ? LOCK_SLOT : 0),
    height: LABEL_HEIGHT * lines.length,
  };
}

interface Size {
  width: number;
  height: number;
}

interface FlowOptions {
  flow: Flow;
}

/** A size as the layout sees it: turned when the ranks run down, so the left-to-right steps below lay out top to bottom. */
function turned(size: Size, options: FlowOptions): Size {
  const { flow } = options;
  switch (flow) {
    case "across":
      return size;
    case "down":
      return { width: size.height, height: size.width };
    default:
      return isNever(flow);
  }
}

function labelRoom(edge: VizEdge, options: FlowOptions): Size {
  return turned(labelSize(edge), options);
}

/** What dagre keeps free for a label: down, also the gap between the label and the line beside it. */
function labelReserve(edge: VizEdge, options: FlowOptions): Size {
  const room = labelRoom(edge, options);
  return options.flow === "down" ? { ...room, height: room.height + LEVEL_CLEAR } : room;
}

export function isDrawn(edge: VizEdge): boolean {
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
function loopsOf(edges: ReadonlyArray<VizEdge>, options: FlowOptions): Loop[] {
  const loops: Loop[] = [];
  let before: Loop | undefined;
  for (const edge of edges) {
    const size = labelRoom(edge, options);
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
  const ids = new Set(machine.states.map((state) => state.id));
  const starts = machine.initial === null ? regionStarts : [machine.initial, ...regionStarts];
  return [...new Set(starts)].filter((id) => ids.has(id));
}

/** `heights` raises a node's box to the room its ports need. */
function specsOf(machine: Drawing, heights: ReadonlyMap<string, number>): Map<string, Spec> {
  const starts = new Set(startIds(machine));
  const specs = new Map<string, Spec>();
  const tall = (id: string, height: number): number => Math.max(height, heights.get(id) ?? 0);
  function loopsAt(id: string): Loop[] {
    const own = machine.edges.filter((edge) => isDrawn(edge) && isLoop(edge) && edge.from === id);
    return loopsOf(own, machine);
  }
  function room(id: string, real: Size): Size {
    const laid = turned(real, machine);
    return { width: laid.width, height: tall(id, laid.height) };
  }
  for (const state of machine.states) {
    const loops = loopsAt(state.id);
    const shape = { worker: hasRow(machine, state), holds: machine.holds.get(state.id) };
    const real = { width: stateWidth(state, shape), height: stateHeight(state, shape) };
    const size = room(state.id, real);
    specs.set(state.id, specOf(state.id, size, loops, starts.has(state.id) ? ENTRY_STUB : 0));
  }
  for (const id of anyIds(machine)) {
    const size = room(id, { width: textWidth(anyLabel(machine, id)) + 24, height: NODE_HEIGHT });
    specs.set(id, specOf(id, size, loopsAt(id), 0));
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

function graphOf(machine: Drawing, specs: ReadonlyMap<string, Spec>): LayoutGraph {
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
    const size = labelReserve(edge, machine);
    const label: EdgeLabel = {
      width: size.width,
      height: size.height,
      labelpos: "c",
    };
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
  machine: Drawing,
): { labels: Map<string, Point>; routes: Map<string, Point[]> } {
  const labels = new Map<string, Point>();
  const routes = new Map<string, Point[]>();
  for (const edge of machine.edges) {
    if (!isDrawn(edge) || isLoop(edge)) continue;
    const placed = graph.edge(edge.from, targetOf(edge), edge.id);
    const centre = { x: placed.x ?? 0, y: placed.y ?? 0 };
    const points = (placed.points ?? []).map((point: Point) => ({ x: point.x, y: point.y }));
    const beside = besideLabel(edge, { machine, centre, points });
    labels.set(edge.id, beside.label);
    routes.set(edge.id, beside.points);
  }
  return { labels, routes };
}

interface BesideOptions {
  machine: Drawing;
  /** Where dagre put the label's reserved room. */
  centre: Point;
  points: Point[];
}

/**
 * Across, the label hangs `LEVEL_CLEAR` under the line, which runs through
 * the room dagre kept. Down, a label is as tall as its text is wide, so it
 * keeps that room and the line moves to the room's edge instead.
 */
function besideLabel(edge: VizEdge, options: BesideOptions): { label: Point; points: Point[] } {
  const { machine, centre, points } = options;
  const room = labelRoom(edge, machine);
  if (machine.flow === "across") {
    return { label: { x: centre.x, y: centre.y + LEVEL_CLEAR + room.height / 2 }, points };
  }
  const line = centre.y - labelReserve(edge, machine).height / 2;
  const moved: Point[] = [];
  for (const point of points) {
    const atLabel = Math.abs(point.x - centre.x) < 0.5 && Math.abs(point.y - centre.y) < 0.5;
    moved.push(atLabel ? { x: point.x, y: line } : point);
  }
  return { label: { x: centre.x, y: centre.y + LEVEL_CLEAR / 2 }, points: moved };
}

interface GeoOptions {
  machine: Drawing;
  specs: ReadonlyMap<string, Spec>;
}

function geoOf(graph: LayoutGraph, options: GeoOptions): Geo {
  const { machine, specs } = options;
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
  const dagreBox = geo.regions.get(region);
  const inside = (point: Point): boolean =>
    dagreBox !== undefined &&
    point.x > dagreBox.left &&
    point.x < dagreBox.right &&
    point.y > dagreBox.top &&
    point.y < dagreBox.bottom;
  for (const edge of context.machine.edges) {
    const centre = geo.labels.get(edge.id);
    if (centre === undefined) continue;
    const size = labelSize(edge);
    if (inside({ x: centre.x, y: centre.y - LEVEL_CLEAR - size.height / 2 }))
      found.push(sidesOf({ ...centre, ...size }));
  }
  for (const route of geo.routes.values()) {
    for (const point of route.slice(1, -1)) {
      if (inside(point))
        found.push({ left: point.x, right: point.x, top: point.y, bottom: point.y });
    }
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
  const tw = textWidth(region) + 8;
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

/** Dagre's `customOrder` hook: it gets dagre's working graph and dagre's own `order`. */
type CustomOrder = (graph: LayoutGraph, order: (graph: LayoutGraph) => void) => void;

/** Dagre's working graph, one line per node: a state id, or a dummy's kind and rank, as dummy ids change on every run. */
function nodeKeys(graph: LayoutGraph): string {
  const keys: string[] = [];
  for (const id of graph.nodes()) {
    const { dummy, rank } = graph.node(id);
    keys.push(dummy === undefined ? id : `${dummy}:${rank}`);
  }
  return keys.join("\n");
}

interface KnownOrder {
  keys: string;
  orders: Array<number | undefined>;
}

/**
 * Dagre's crossing reduction, run once and replayed on the later passes.
 * A later pass changes box heights only, and the order depends on the graph
 * alone; when the working graph differs, it orders afresh.
 */
function orderOnce(): CustomOrder {
  const known: KnownOrder = { keys: "", orders: [] };
  const reorder: CustomOrder = (graph, order) => {
    const ids: string[] = graph.nodes();
    const keys = nodeKeys(graph);
    if (keys !== known.keys) {
      order(graph);
      known.keys = keys;
      known.orders = ids.map((id) => graph.node(id).order);
      return;
    }
    for (const [index, id] of ids.entries()) {
      const at = known.orders[index];
      if (at !== undefined) graph.node(id).order = at;
    }
  };
  return reorder;
}

/** Runs dagre until every node's box is tall enough for its ports (at most 3 passes). */
function laidOut(machine: Drawing): { graph: LayoutGraph; specs: Map<string, Spec>; geo: Geo } {
  const starts = new Set(startIds(machine));
  const heights = new Map<string, number>();
  const customOrder = orderOnce();
  for (let pass = 0; ; pass++) {
    const specs = specsOf(machine, heights);
    const graph = graphOf(machine, specs);
    layout(graph, { customOrder });
    const geo = geoOf(graph, { machine, specs });
    const boxes = new Map(
      [...specs].map(([id, spec]) => [id, boxOf(spec, geo.nodes.get(id) ?? { x: 0, y: 0 })]),
    );
    const { need } = assignPorts(endsOf(machine, geo.routes), boxes, starts);
    const grown = [...need].filter(([id, height]) => height > (specs.get(id)?.height ?? 0));
    if (grown.length === 0 || pass === 2) return { graph, specs, geo };
    for (const [id, height] of grown) heights.set(id, height);
  }
}

interface Routing {
  specs: ReadonlyMap<string, Spec>;
  boxes: ReadonlyMap<string, LabelBox>;
  geo: Geo;
  ports: ReadonlyMap<string, Port>;
  columns: Columns;
}

/** A drawn edge on its route: a loop beside its node, else level from port to port. */
function routedOf(edge: VizEdge, options: Routing): PlacedEdge {
  const { specs, boxes, geo, ports, columns } = options;
  if (isLoop(edge)) {
    const at = boxes.get(edge.from);
    const loop = specs.get(edge.from)?.loops.find((each) => each.edge === edge);
    if (at !== undefined && loop !== undefined) return loopPlaced(edge, loop, at);
  }
  const route = geo.routes.get(edge.id) ?? [];
  const points = levelRoute(edge, route, ports, columns);
  return placedOf(edge, points, geo.labels.get(edge.id) ?? { x: 0, y: 0 }, pathLength(points));
}

interface SharedIn {
  shared: Shared;
}

/**
 * The real edges each drawn arrow stands for, when that is not just itself: a
 * shared arrow's members, and the members of a group arrow of a fold, so the
 * marks and a click can find the one that leaves the current state.
 */
function drawnMembersOf(base: VizMachine, options: SharedIn): Map<string, string[]> {
  const { shared } = options;
  const members = new Map<string, string[]>();
  for (const edge of shared.edges) {
    const real = realMembersOf(base, { shared, arrow: edge.id });
    const alone = real.length === 1 && real[0] === edge.id;
    if (!alone) members.set(edge.id, real);
  }
  return members;
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

/** How a machine is laid out. */
export interface LayoutOptions {
  /** Default "across". "down" applies only to a machine that `canTurn`; any other is laid out across. */
  flow?: Flow;
}

/** True when the layout can run top to bottom: no regions, no actor maps and no messages, whose drawing assumes left to right. */
export function canTurn(machine: VizMachine): boolean {
  const plain = machine.regions.length === 0 && machine.maps.length === 0;
  return plain && messagesOf(machine).length === 0;
}

/**
 * Layered layout (dagre, left to right, or top to bottom for `flow: "down"`).
 * Pure: same machine in, same coordinates out. The initial edge is drawn as an
 * entry arrow, not a graph edge.
 */
export function placeMachine(base: VizMachine, options: LayoutOptions = {}): MachineLayout {
  const flow = options.flow === "down" && canTurn(base) ? "down" : "across";
  const shared = shareArrows(base);
  const holds = new Map<string, Holds>();
  for (const state of base.states) {
    const held = holdsOf(base, state);
    if (held !== undefined) holds.set(state.id, held);
  }
  const machine: Drawing = {
    ...base,
    edges: [...shared.edges, ...messagesOf(base).map(messageEdge)],
    shared,
    holds,
    members: drawnMembersOf(base, { shared }),
    flow,
  };
  const { specs, geo } = laidOut(machine);
  const context: Context = { machine, specs, owners: ownersOf(machine) };
  const regions = [...machine.regions].sort(
    (a, b) => b.split(".").length - a.split(".").length || a.localeCompare(b),
  );
  for (const region of regions) fitRegion(region, geo, context);
  let built = assemble(machine, specs, geo, regions);
  if (built.widen.length > 0) {
    for (const { at, by } of [...built.widen].sort((a, b) => b.at - a.at))
      insertSpace(geo, "x", at, by);
    built = assemble(machine, specs, geo, regions);
  }
  if (built.layout.messages.length > 0) {
    const ys = [...built.layout.messages, ...built.layout.edges].flatMap((line) =>
      line.points.map((point) => point.y),
    );
    const shift = Math.max(0, LABEL_PAD - Math.min(...ys));
    insertSpace(geo, "y", -Infinity, shift);
    geo.height = Math.max(geo.height, Math.max(...ys) + shift + LABEL_PAD);
    built = assemble(machine, specs, geo, regions);
  }
  return flow === "down" ? turnedBack(built.layout, machine) : built.layout;
}

function pointBack(point: Point): Point {
  return { x: point.y, y: point.x };
}

function boxBack(laid: LabelBox): LabelBox {
  return { x: laid.y, y: laid.x, width: laid.height, height: laid.width };
}

/** A node of the turned layout, turned back: a state's name, chips and row are placed again in its real box. */
function nodeBack(node: PlacedNode, machine: Drawing): PlacedNode {
  const real = boxBack(node);
  switch (node.kind) {
    case "state":
    case "machine": {
      const holds = machine.holds.get(node.id);
      return placedStateOf(node.state, { box: real, worker: false, holds });
    }
    case "any":
    case "unknown":
      return { ...node, ...real };
    default:
      return isNever(node);
  }
}

/** An arrow of the turned layout, turned back: its label reads across, beside the line. */
function edgeBack(placed: PlacedEdge): PlacedEdge {
  const points: Point[] = [];
  for (const point of placed.points) points.push(pointBack(point));
  return {
    ...placed,
    points,
    path: polyline(points),
    ...boxed(placed.edge, pointBack(placed.label)),
  };
}

/** The layout of turned sizes, turned back so its ranks run top to bottom; it widens to hold each label, which sits right of its line. */
function turnedBack(laid: MachineLayout, machine: Drawing): MachineLayout {
  const nodes: PlacedNode[] = [];
  for (const node of laid.nodes) nodes.push(nodeBack(node, machine));
  const edges: PlacedEdge[] = [];
  for (const placed of laid.edges) edges.push(edgeBack(placed));
  const entries: MachineLayout["entries"] = [];
  for (const entry of laid.entries) {
    entries.push({ from: pointBack(entry.from), to: pointBack(entry.to) });
  }
  let width = laid.height;
  for (const placed of edges) {
    width = Math.max(width, placed.label.x + placed.label.width / 2 + MARGIN_Y);
  }
  return { ...laid, width, height: laid.width, nodes, edges, entries };
}

function assemble(
  machine: Drawing,
  specs: ReadonlyMap<string, Spec>,
  geo: Geo,
  regions: ReadonlyArray<string>,
): { layout: MachineLayout; widen: Widen[] } {
  const boxes = new Map<string, LabelBox>();
  for (const [id, spec] of specs) boxes.set(id, boxOf(spec, geo.nodes.get(id) ?? { x: 0, y: 0 }));
  const starts = startIds(machine);
  const { ports, entryY } = assignPorts(endsOf(machine, geo.routes), boxes, new Set(starts));
  const nodes = placeNodes(machine, specs, boxes);
  const columns = columnsOf(geo, { specs, machine });
  const placedRegions = regions
    .map((region) => {
      const sides = geo.regions.get(region) ?? { left: 0, right: 0, top: 0, bottom: 0 };
      const tw = textWidth(region) + 8;
      return {
        region,
        x: (sides.left + sides.right) / 2,
        y: (sides.top + sides.bottom) / 2,
        width: sides.right - sides.left,
        height: sides.bottom - sides.top,
        title: titleOf(sides, tw),
      };
    })
    .sort((a, b) => machine.regions.indexOf(a.region) - machine.regions.indexOf(b.region));
  const edges: PlacedEdge[] = [];
  for (const edge of machine.edges) {
    if (!isDrawn(edge)) continue;
    const placed = routedOf(edge, { specs, boxes, geo, ports, columns });
    const members = machine.members.get(edge.id);
    const arrow = machine.shared.arrows.find((each) => each.id === edge.id);
    const sources = arrow === undefined ? {} : { sources: sourcesOf(machine, arrow).length };
    edges.push(members === undefined ? placed : { ...placed, members, ...sources });
  }
  const laned = lanesOf(
    edges,
    placedRegions.map((region) => region.title),
  );
  return {
    widen: laned.widen,
    layout: {
      width: geo.width,
      height: geo.height,
      nodes,
      edges: laned.edges.filter((placed) => !isMessage(placed.edge)),
      messages: laned.edges
        .filter((placed) => isMessage(placed.edge))
        .map((placed) => ({
          from: placed.edge.from,
          to: placed.target,
          path: placed.path,
          points: placed.points,
          dotGap: placed.dotGap,
        })),
      regions: placedRegions,
      entries: starts.map((id) => {
        const at = boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
        const left = at.x - at.width / 2;
        const y = entryY.get(id) ?? at.y;
        return { from: { x: left - ENTRY_LENGTH, y }, to: { x: left, y } };
      }),
    },
  };
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

function polyline(points: ReadonlyArray<Point>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function boxed(edge: VizEdge, centre: Point): Pick<PlacedEdge, "label" | "text"> {
  const size = labelSize(edge);
  const shift = ((edge.kind === "transition" ? LOCK_SLOT : 0) - HELP_SLOT) / 2;
  return {
    label: { x: centre.x, y: centre.y, ...size },
    text: { x: centre.x + shift, y: centre.y },
  };
}

interface NodeSpot extends StateShape {
  box: LabelBox;
}

interface RowAt {
  label: LabelBox;
}

/** The row under a group node's name: glyph, the row's text, then the enter control, centred as a whole. */
function machineRowOf(
  holds: Holds,
  options: RowAt,
): Pick<PlacedMachine, "glyph" | "name" | "enter"> {
  const { label } = options;
  const width = machineRowWidth(holds);
  const left = label.x - width / 2;
  const y = label.y + label.height / 2 + LABEL_PAD + MACHINE_ROW_HEIGHT / 2;
  const nameWidth = rowTextWidth(holds);
  return {
    glyph: { x: left + MACHINE_GLYPH / 2, y, width: MACHINE_GLYPH, height: MACHINE_GLYPH },
    name: {
      x: left + MACHINE_GLYPH + LABEL_PAD + nameWidth / 2,
      y,
      width: nameWidth,
      height: MACHINE_ROW_HEIGHT,
    },
    enter: { x: left + width - ENTER_WIDTH / 2, y, width: ENTER_WIDTH, height: MACHINE_ROW_HEIGHT },
  };
}

function placedStateOf(state: VizState, spot: NodeSpot): PlacedState | PlacedMachine {
  const inside = insideOf(state, spot);
  const { holds } = spot;
  if (holds === undefined) {
    return { kind: "state", id: state.id, state, ...spot.box, ...inside };
  }
  return {
    kind: "machine",
    id: state.id,
    state,
    holds,
    ...spot.box,
    ...inside,
    ...machineRowOf(holds, { label: inside.label }),
  };
}

function placeNodes(
  machine: Drawing,
  specs: ReadonlyMap<string, Spec>,
  boxes: ReadonlyMap<string, LabelBox>,
): PlacedNode[] {
  const at = (id: string): LabelBox => boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
  const states: PlacedNode[] = machine.states.map((state) =>
    placedStateOf(state, {
      box: at(state.id),
      worker: hasRow(machine, state),
      holds: machine.holds.get(state.id),
    }),
  );
  const anys: PlacedAny[] = anyIds(machine).map((id) => ({
    kind: "any",
    id,
    label: anyLabel(machine, id),
    states: sourcesOf(machine, { node: id }),
    walked: machine.shared.nodes.find((node) => node.id === id)?.walked ?? [],
    ...at(id),
  }));
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

interface Column {
  left: number;
  right: number;
}

interface Columns {
  at: (x: number) => Column;
  ofNode: (id: string) => Column;
}

/**
 * dagre puts every item of one rank at one x, so a rank is a column. Its
 * extent is the widest node footprint (with the finding mark) or label in it;
 * every route point is a label's, so it adds none.
 */
interface ColumnsOptions {
  specs: ReadonlyMap<string, Spec>;
  machine: Drawing;
}

function columnsOf(geo: Geo, options: ColumnsOptions): Columns {
  const { specs, machine } = options;
  const columns = new Map<number, Column>();
  const key = (x: number): number => Math.round(2 * x);
  const grow = (x: number, half: number): void => {
    const column = columns.get(key(x)) ?? { left: x, right: x };
    column.left = Math.min(column.left, x - half);
    column.right = Math.max(column.right, x + half);
    columns.set(key(x), column);
  };
  for (const [id, spec] of specs) {
    const centre = geo.nodes.get(id);
    if (centre !== undefined) grow(centre.x, (spec.entry + spec.inner) / 2 + MARK_OVERHANG);
  }
  for (const edge of machine.edges) {
    const centre = geo.labels.get(edge.id);
    if (centre !== undefined) grow(centre.x, labelRoom(edge, machine).width / 2);
  }
  const at = (x: number): Column => columns.get(key(x)) ?? { left: x, right: x };
  return { at, ofNode: (id) => at(geo.nodes.get(id)?.x ?? 0) };
}

/**
 * The route from port to port, level wherever it is inside a column: it
 * leaves each end and crosses each interior column at its own height, and
 * slopes only between columns, `LEVEL_CLEAR` outside the widest item.
 */
function levelRoute(
  edge: VizEdge,
  route: ReadonlyArray<Point>,
  ports: ReadonlyMap<string, Port>,
  columns: Columns,
): Point[] {
  const first = ports.get(portKey(edge.id, true));
  const last = ports.get(portKey(edge.id, false));
  if (first === undefined || last === undefined) return [...route];
  const clear = (port: Port, node: string): number => {
    const column = columns.ofNode(node);
    return port.side === 1 ? column.right + LEVEL_CLEAR : column.left - LEVEL_CLEAR;
  };
  const points: Point[] = [
    { x: first.x, y: first.y },
    { x: clear(first, edge.from), y: first.y },
  ];
  for (const point of route.slice(1, -1)) {
    const column = columns.at(point.x);
    const across = [
      { x: column.left - LEVEL_CLEAR, y: point.y },
      { x: column.right + LEVEL_CLEAR, y: point.y },
    ];
    const from = points.at(-1)?.x ?? point.x;
    points.push(...(from <= point.x ? across : across.reverse()));
  }
  points.push({ x: clear(last, targetOf(edge)), y: last.y }, { x: last.x, y: last.y });
  return points;
}
/** A layout and what overlaps in it: it is drawn either way, and the viewer warns when `overlaps` is not empty. */
export interface CheckedLayout {
  layout: MachineLayout;
  overlaps: Overlap[];
}

export function checkedLayout(placed: MachineLayout): CheckedLayout {
  return { layout: placed, overlaps: overlapsOf(placed) };
}

/** The layout and its overlaps, or the error when dagre or a missing node spec stops it. */
export function layoutMachine(
  machine: VizMachine,
  options: LayoutOptions = {},
): Either<unknown, CheckedLayout> {
  const placed = Either.from(() => placeMachine(machine, options));
  return Either.isLeft(placed) ? placed : Either.right(checkedLayout(placed[1]));
}

interface Widen {
  /** x in the middle of the gap. */
  at: number;
  by: number;
}

export interface Gap {
  start: number;
  end: number;
  crossings: Crossing[];
}

interface Crossing {
  edge: number;
  from: number;
  yLeft: number;
  yRight: number;
  id: string;
}

export interface Piece {
  crossing: Crossing;
  yLeft: number;
  yRight: number;
}

function byMiddle(a: Piece, b: Piece): number {
  return (
    (a.yLeft + a.yRight) / 2 - (b.yLeft + b.yRight) / 2 ||
    a.crossing.id.localeCompare(b.crossing.id) ||
    a.yLeft - b.yLeft
  );
}

/** A row at least `PATH_GAP` from every row in the gap and clear of the titles over it, nearest the piece's middle. */
function jogRow(
  rows: ReadonlyArray<number>,
  piece: Piece,
  gap: { start: number; end: number },
  titles: ReadonlyArray<LabelBox>,
): number {
  const sorted = [...rows].sort((a, b) => a - b);
  const low = sorted[0] ?? piece.yLeft;
  const high = sorted.at(-1) ?? piece.yRight;
  const candidates = [low - PATH_GAP, high + PATH_GAP];
  for (let i = 1; i < sorted.length; i++) {
    const above = sorted[i - 1] ?? low;
    const below = sorted[i] ?? high;
    if (below - above >= 2 * PATH_GAP) candidates.push((above + below) / 2);
  }
  const clear = (y: number): boolean =>
    titles.every(
      (t) =>
        t.x + t.width / 2 < gap.start ||
        t.x - t.width / 2 > gap.end ||
        Math.abs(y - t.y) >= t.height / 2 + LANE_TITLE_CLEAR,
    );
  const free = candidates.filter(clear);
  const middle = (piece.yLeft + piece.yRight) / 2;
  const nearest = [...(free.length > 0 ? free : candidates)].sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b,
  )[0];
  return nearest ?? low - PATH_GAP;
}

/** The pieces `a` waits for: those whose left row is level with `a`'s right row. */
function blockers(a: Piece, waiting: ReadonlyArray<Piece>): Piece[] {
  return waiting.filter((b) => b !== a && Math.abs(a.yRight - b.yLeft) < LANE_ROW_CLASH);
}

/** Follow the lowest blocker from the lowest piece until one repeats: the lowest piece on that cycle. */
function inCycle(waiting: ReadonlyArray<Piece>): Piece | undefined {
  const seen: Piece[] = [];
  let at = [...waiting].sort(byMiddle)[0];
  while (at !== undefined && !seen.includes(at)) {
    seen.push(at);
    at = blockers(at, waiting).sort(byMiddle)[0];
  }
  return at === undefined ? undefined : seen.slice(seen.indexOf(at)).sort(byMiddle)[0];
}

/**
 * Left to right: a piece waits for any whose left end is level with its right
 * end, so their level pieces never share a row. When every piece waits (two
 * arrows swap rows), the lowest on a cycle splits at a free row: its first
 * part goes now, its second part waits.
 */
export function laneOrder(
  gap: Gap,
  levelRows: ReadonlyArray<number>,
  titles: ReadonlyArray<LabelBox>,
): Piece[] {
  let waiting: Piece[] = gap.crossings.map((crossing) => ({
    crossing,
    yLeft: crossing.yLeft,
    yRight: crossing.yRight,
  }));
  let rows = [...levelRows, ...gap.crossings.flatMap((c) => [c.yLeft, c.yRight])];
  const order: Piece[] = [];
  while (waiting.length > 0) {
    const ready = waiting.filter((a) =>
      waiting.every((b) => b === a || Math.abs(a.yRight - b.yLeft) >= LANE_ROW_CLASH),
    );
    const next = ready.length > 0 ? [...ready].sort(byMiddle)[0] : inCycle(waiting);
    if (next === undefined) break;
    if (ready.length > 0) {
      order.push(next);
      waiting = waiting.filter((p) => p !== next);
      continue;
    }
    const row = jogRow(rows, next, gap, titles);
    rows = [...rows, row];
    order.push({ ...next, yRight: row });
    waiting = waiting.map((p) => (p === next ? { ...next, yLeft: row } : p));
  }
  return order;
}

/** The first x at or after `from` where a vertical lane from `top` to `bottom` clears every region title. */
export function freeLane(
  from: number,
  top: number,
  bottom: number,
  titles: ReadonlyArray<LabelBox>,
): number {
  let x = from;
  for (const title of [...titles].sort((a, b) => a.x - b.x)) {
    const meets =
      title.y + title.height / 2 + LANE_TITLE_CLEAR > top &&
      title.y - title.height / 2 - LANE_TITLE_CLEAR < bottom;
    const left = title.x - title.width / 2 - LANE_TITLE_CLEAR;
    const right = title.x + title.width / 2 + LANE_TITLE_CLEAR;
    if (meets && x > left && x < right) x = right;
  }
  return x;
}

/** The vertical pieces of one sloped segment, in the order the path walks them. */
export function lanePoints(
  lanes: ReadonlyArray<{ x: number; piece: Piece }>,
  rightward: boolean,
): Point[] {
  return (rightward ? lanes : [...lanes].reverse()).flatMap(({ x, piece }) =>
    rightward
      ? [
          { x, y: piece.yLeft },
          { x, y: piece.yRight },
        ]
      : [
          { x, y: piece.yRight },
          { x, y: piece.yLeft },
        ],
  );
}

/**
 * Every sloped piece between two columns becomes level, then a vertical lane
 * of its own, then level: lanes are `PATH_GAP` apart, so steep arrows never
 * run alongside. A gap too narrow for its lanes reports how much to widen.
 */
export function lanesOf(
  edges: ReadonlyArray<PlacedEdge>,
  titles: ReadonlyArray<LabelBox>,
): { edges: PlacedEdge[]; widen: Widen[] } {
  const gaps = new Map<string, Gap>();
  const level = new Map<string, number[]>();
  edges.forEach((placed, edge) => {
    if (isLoop(placed.edge)) return;
    for (let from = 1; from < placed.points.length; from++) {
      const a = placed.points[from - 1];
      const b = placed.points[from];
      if (a === undefined || b === undefined) continue;
      if (Math.abs(a.x - b.x) < 1) continue;
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const key = `${left.x.toFixed(1)}|${right.x.toFixed(1)}`;
      if (Math.abs(a.y - b.y) < 0.5) {
        level.set(key, [...(level.get(key) ?? []), a.y]);
        continue;
      }
      const gap: Gap = gaps.get(key) ?? { start: left.x, end: right.x, crossings: [] };
      gap.crossings.push({ edge, from, yLeft: left.y, yRight: right.y, id: placed.edge.id });
      gaps.set(key, gap);
    }
  });
  const lanes = new Map<number, Map<number, Array<{ x: number; piece: Piece }>>>();
  const widen: Widen[] = [];
  for (const [key, gap] of gaps) {
    let x = gap.start;
    for (const piece of laneOrder(gap, level.get(key) ?? [], titles)) {
      const top = Math.min(piece.yLeft, piece.yRight);
      const bottom = Math.max(piece.yLeft, piece.yRight);
      x = freeLane(x + PATH_GAP, top, bottom, titles);
      const crossing = piece.crossing;
      const own = lanes.get(crossing.edge) ?? new Map<number, Array<{ x: number; piece: Piece }>>();
      own.set(crossing.from, [...(own.get(crossing.from) ?? []), { x, piece }]);
      lanes.set(crossing.edge, own);
    }
    if (x > gap.end - PATH_GAP)
      widen.push({ at: (gap.start + gap.end) / 2, by: x - gap.end + PATH_GAP });
  }
  const laned = edges.map((placed, edge) => {
    const own = lanes.get(edge);
    if (own === undefined) return placed;
    const points: Point[] = [];
    placed.points.forEach((point, index) => {
      const list = own.get(index);
      const previous = placed.points[index - 1];
      if (list !== undefined && previous !== undefined) {
        points.push(...lanePoints(list, previous.x < point.x));
      }
      points.push(point);
    });
    return { ...placed, points, path: polyline(points) };
  });
  return { edges: laned, widen };
}
