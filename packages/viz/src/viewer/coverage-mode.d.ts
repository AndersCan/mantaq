import type { VizCoverage, VizMachine } from "../schema.ts";
/** Which hit counts the overlay dims by: the run (fuzz or history), the test sequences, or both together. */
export type CoverageMode = "off" | "run" | "tests" | "reached";
interface Measured {
  coverage: VizCoverage | null;
  tested: VizCoverage | null;
}
/** Modes this machine has data for, best first: tests answer "what is untested?". */
export declare function availableModes(machine: VizMachine): CoverageMode[];
export declare function measure(mode: CoverageMode, item: Measured): VizCoverage | null;
export declare function modeLabel(mode: CoverageMode, machine: VizMachine): string;
export {};
