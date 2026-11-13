import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import type { Point } from "@dagrejs/dagre";
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
  entries: Array<{
    from: Point;
    to: Point;
  }>;
}
export declare const CHAR_WIDTH = 7;
/** Shortest drawn edge between two nodes, and the closest two nodes may sit. */
export declare const MIN_EDGE_LENGTH = 72;
export declare const NODE_SEPARATION = 36;
export declare function polyline(points: ReadonlyArray<Point>): string;
export declare function pathLength(points: ReadonlyArray<Point>): number;
export declare function dotGapFor(length: number): number;
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * Moves each label vertically (0, +1, -1, +2, -2 steps) to the first spot that
 * clears every label placed before it. Pure and order-stable.
 */
export declare function separateLabels(boxes: ReadonlyArray<LabelBox>): LabelBox[];
/**
 * Layered layout (dagre, left to right). Pure: same machine in, same
 * coordinates out. The initial edge is drawn as an entry arrow, not a graph edge.
 */
export declare function layoutMachine(machine: VizMachine): MachineLayout;
