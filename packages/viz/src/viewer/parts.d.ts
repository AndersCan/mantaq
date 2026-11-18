import type { VizMachine } from "../schema.ts";
/** "" (the machine's own actor) then each actor returned beside it; [] below three machines. */
export declare function partsOf(machine: VizMachine): string[];
/** The actor an id belongs to (`a` or `a.…`); "" for the machine's own. */
export declare function partOf(machine: VizMachine, id: string): string;
export declare function partName(machine: VizMachine, part: string): string;
/** The machine as one part draws it: its own states, regions, maps and arrows, and no actors. */
export declare function partMachine(machine: VizMachine, part: string): VizMachine;
