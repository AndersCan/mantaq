import type { VizEdge, VizMachine } from "../schema.ts";
interface SharedNode {
  id: string;
  scope: string;
  states: string[];
  label: string;
}
export interface SharedArrow {
  id: string;
  node: string;
  event: string;
  /** The real edge each source state has, in source order. */
  members: VizEdge[];
  /** What is drawn: the first member, from the node. */
  drawn: VizEdge;
}
export interface Shared {
  edges: VizEdge[];
  nodes: SharedNode[];
  arrows: SharedArrow[];
}
/** A node made here, not an `onAny` one: `region.*3`. */
export declare function isSharedNode(id: string): boolean;
/** The edges to draw: arrows several sibling states take alike are replaced by one from a shared node. */
export declare function shareArrows(machine: VizMachine): Shared;
/** The member a click acts on: the one whose source state is current, if any. */
export declare function memberAt(
  arrow: SharedArrow,
  currents: ReadonlyArray<string>,
): VizEdge | undefined;
export {};
