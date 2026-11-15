import type { VizEdge } from "../schema.ts";
/** Text drawn on an edge: the event it carries. */
export declare function edgeText(edge: VizEdge): string;
/**
 * When a handler can also go elsewhere, the condition under which it reaches
 * `edge.to`, read from the analyzed branches. null when it is unconditional,
 * unreadable, or depends on actor state.
 */
export declare function edgeCondition(edge: VizEdge): string | null;
/** The lines drawn on an edge: the event, then its condition cut to fit. */
export declare function edgeLines(edge: VizEdge): string[];
