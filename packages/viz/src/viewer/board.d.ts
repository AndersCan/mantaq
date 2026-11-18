import type { Point } from "@dagrejs/dagre";
import type { VizMachine } from "../schema.ts";
/** A part's box; x and y are its centre. */
export interface PlacedPart {
  part: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PlacedWire {
  from: string;
  to: string;
  both: boolean;
  path: string;
  points: Point[];
  dotGap: number;
}
export interface BoardLayout {
  width: number;
  height: number;
  parts: PlacedPart[];
  wires: PlacedWire[];
}
/** One box per part: parts that message each other placed by their wires, the rest in rows that fill `width`. */
export declare function placeBoard(machine: VizMachine, width: number): BoardLayout;
export {};
