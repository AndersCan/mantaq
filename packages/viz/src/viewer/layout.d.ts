import type { VizEdge, VizFuzzMessage, VizMachine, VizState } from "../schema.ts";
import type { Overlap } from "./overlaps.ts";
import { Either } from "@mantaq/utils";
import type { Point } from "@dagrejs/dagre";
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
  /** The states a shared node stands for; empty for an `onAny` node. */
  states: string[];
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
  /** Ids of the edges a shared arrow stands for; absent when it is one edge. */
  members?: string[];
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
export interface MachineLayout {
  width: number;
  height: number;
  nodes: Array<PlacedState | PlacedUnknown | PlacedAny>;
  edges: PlacedEdge[];
  messages: PlacedMessage[];
  regions: PlacedRegion[];
  /** Entry arrows: into the machine's start state, then into each region's, sorted by state id. */
  entries: Array<{
    from: Point;
    to: Point;
  }>;
}
/**
 * Width in px of `text`: the widest advance of the fonts the viewer may use,
 * per character (measured at 12px), scaled to `fontSize`, with 5% slack.
 */
export declare function textWidth(text: string, fontSize?: number): number;
/** Room left of a transition's label for its lock. */
export declare const LOCK_SLOT = 12;
/** Room right of a label's first line for its `?`. */
export declare const HELP_SLOT = 12;
/** Label to its own arrow, and to any other arrow: strictly farther, so the nearest arrow is always its own. */
export declare const LABEL_OWN = 8;
export declare const LABEL_FOREIGN = 14;
export declare const PORT_GAP: number;
export declare const STUB = 12;
export declare const ENTRY_LENGTH = 28;
export declare const LOOP_BASE = 16;
export declare const LEG_GAP: number;
export declare const LEG_INSET = 16;
export declare const LOOP_FIRST_SPAN = 24;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export declare const MIN_EDGE_LENGTH = 72;
export declare const NODE_SEPARATION = 36;
interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Messages fuzzing saw one machine send another: one line per (from, to) and per (from, event, receiving machine), in document order. */
export declare function messagesOf(machine: VizMachine): VizFuzzMessage[];
export declare function isDrawn(edge: VizEdge): boolean;
/**
 * Layered layout (dagre, left to right). Pure: same machine in, same
 * coordinates out. The initial edge is drawn as an entry arrow, not a graph edge.
 */
export declare function placeMachine(base: VizMachine): MachineLayout;
export declare function pathLength(points: ReadonlyArray<Point>): number;
export declare function dotGapFor(length: number): number;
/** The layout unless it overlaps itself: then the overlaps. */
export declare function checkedLayout(placed: MachineLayout): Either<Overlap[], MachineLayout>;
/** The layout, or the error when dagre or a missing node spec stops it, or the overlaps when it still overlaps. */
export declare function layoutMachine(machine: VizMachine): Either<unknown, MachineLayout>;
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
/**
 * Left to right: a piece waits for any whose left end is level with its right
 * end, so their level pieces never share a row. When every piece waits (two
 * arrows swap rows), the lowest on a cycle splits at a free row: its first
 * part goes now, its second part waits.
 */
export declare function laneOrder(
  gap: Gap,
  levelRows: ReadonlyArray<number>,
  titles: ReadonlyArray<LabelBox>,
): Piece[];
/** The first x at or after `from` where a vertical lane from `top` to `bottom` clears every region title. */
export declare function freeLane(
  from: number,
  top: number,
  bottom: number,
  titles: ReadonlyArray<LabelBox>,
): number;
/** The vertical pieces of one sloped segment, in the order the path walks them. */
export declare function lanePoints(
  lanes: ReadonlyArray<{
    x: number;
    piece: Piece;
  }>,
  rightward: boolean,
): Point[];
/**
 * Every sloped piece between two columns becomes level, then a vertical lane
 * of its own, then level: lanes are `PATH_GAP` apart, so steep arrows never
 * run alongside. A gap too narrow for its lanes reports how much to widen.
 */
export declare function lanesOf(
  edges: ReadonlyArray<PlacedEdge>,
  titles: ReadonlyArray<LabelBox>,
): {
  edges: PlacedEdge[];
  widen: Widen[];
};
export {};
