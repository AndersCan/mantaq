import type { VizCoverage, VizMachine } from "../schema.ts";

/** Which hit counts the overlay dims by: the run (fuzz or history) or the test sequences. */
export type CoverageMode = "off" | "run" | "tests";

interface Measured {
  coverage: VizCoverage | null;
  tested: VizCoverage | null;
}

function items(machine: VizMachine): Measured[] {
  return [...machine.states, ...machine.edges];
}

/** Modes this machine has data for, best first: tests answer "what is untested?". */
export function availableModes(machine: VizMachine): CoverageMode[] {
  const modes: CoverageMode[] = [];
  if (items(machine).some((item) => item.tested !== null)) modes.push("tests");
  if (items(machine).some((item) => item.coverage !== null)) modes.push("run");
  return modes;
}

export function measure(mode: CoverageMode, item: Measured): VizCoverage | null {
  if (mode === "run") return item.coverage;
  if (mode === "tests") return item.tested;
  return null;
}

export function modeLabel(mode: CoverageMode, machine: VizMachine): string {
  if (mode === "tests") return "example tests";
  if (mode === "run") return machine.fuzz === null ? "supplied run" : "fuzz runs";
  return "off";
}
