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
}
/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
export declare function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement | HTMLElement;
