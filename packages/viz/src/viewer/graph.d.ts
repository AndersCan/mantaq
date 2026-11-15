import type { VizMachine } from "../schema.ts";
import type { CoverageMode } from "./coverage-mode.ts";
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
  /** Show the details of a selection without taking a step. */
  showDetails(
    selection: Selection,
    options?: {
      findings: boolean;
    },
  ): void;
  /** Coverage source the overlay dims by. */
  mode: CoverageMode;
  /** Draw only state names, effect names and arrow labels: no finding marks, no "?" hints. */
  bare?: boolean;
}
/** Static SVG for one machine. Regions first, then edges, then nodes, so nodes sit on top. */
export declare function renderGraph(
  doc: Document,
  machine: VizMachine,
  callbacks: GraphCallbacks,
): SVGSVGElement;
