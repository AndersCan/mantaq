import type { VizEdge } from "../schema.ts";

/** Text drawn on an edge: the event it carries. */
export function edgeText(edge: VizEdge): string {
  return edge.event;
}
