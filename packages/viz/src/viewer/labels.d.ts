import type { VizEdge } from "../schema.ts";
/**
 * When one event can lead to several states, what sets this arrow apart:
 * its own conditions, `else` for the side the others rule out. Null when the
 * arrow is the only way the event goes, or its handler is unreadable.
 */
export declare function edgeCondition(edge: VizEdge): string | null;
/** The lines drawn on an edge: the event, then its condition in full. */
export declare function edgeLines(edge: VizEdge): string[];
