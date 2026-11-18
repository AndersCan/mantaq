import type { VizMachine } from "../schema.ts";
export type Selection =
  | {
      kind: "edge";
      id: string;
    }
  | {
      kind: "state";
      id: string;
    };
export interface GraphCallbacks {
  select(selection: Selection): void;
  /** Opens an arrow's Details without sending. Absent: no `?` is drawn (diagram-only). */
  details?: (edgeId: string) => void;
}
/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
export declare function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement | HTMLElement;
/** Board pixels per unit: a canvas of `w` px is laid out `w / 0.9` units wide, so names read at 10.8 px or more. */
export declare const BOARD_PX_PER_UNIT = 0.9;
/** The machines of a big board as named boxes, dotted wires between those that message each other. */
export declare function renderBoard(
  doc: Document,
  machine: VizMachine,
  context: {
    width: number;
    open: (part: string) => void;
  },
): SVGSVGElement;
