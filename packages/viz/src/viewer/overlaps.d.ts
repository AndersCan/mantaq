import type { Point } from "@dagrejs/dagre";
import type { MachineLayout } from "./layout.ts";
type Part =
  | `label:${string}`
  | `path:${string}`
  | `arrow:${string}`
  | `node:${string}`
  | `region:${string}`
  | `title:${string}`
  | `entry:${string}`
  | "canvas";
export type Rule =
  | "label-clear"
  | "path-through-node"
  | "paths-near"
  | "arrowheads"
  | "nodes"
  | "node-inside"
  | "region-edge"
  | "outside";
/** `gap` is the measured distance in px; negative means the boxes intersect. */
export interface Overlap {
  rule: Rule;
  a: Part;
  b: Part;
  gap: number;
}
/** Points of an SVG path as written today: `M`/`L` lines and `C` Béziers sampled at t = 0.02 steps. */
export declare function pathPoints(path: string): Point[];
/**
 * Every overlap in a layout, as plain data. Pure, never mutates, sorted by
 * (rule, a, b). Works on today's `MachineLayout`: Béziers are sampled and a
 * label's size comes from its text.
 */
export declare function overlapsOf(layout: MachineLayout): Overlap[];
/** One line per overlap, for a failing assertion's message. */
export declare function overlapLines(overlaps: ReadonlyArray<Overlap>): string[];
export {};
