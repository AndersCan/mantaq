import type { VizCoverage, VizMachine } from "../schema.ts";

/** Which hit counts the overlay dims by: the run (fuzz or history), the test sequences, or both together. */
export type CoverageMode = "off" | "run" | "tests" | "reached";

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
  const tested = items(machine).some((item) => item.tested !== null);
  const run = items(machine).some((item) => item.coverage !== null);
  if (tested && run) modes.push("reached");
  if (tested) modes.push("tests");
  if (run) modes.push("run");
  return modes;
}

export function measure(mode: CoverageMode, item: Measured): VizCoverage | null {
  if (mode === "run") return item.coverage;
  if (mode === "tests") return item.tested;
  if (mode === "reached") {
    if (item.coverage === null && item.tested === null) return null;
    return { hits: (item.coverage?.hits ?? 0) + (item.tested?.hits ?? 0) };
  }
  return null;
}

export function modeLabel(mode: CoverageMode, machine: VizMachine): string {
  if (mode === "tests") return "example tests";
  if (mode === "reached") return "examples + fuzz";
  if (mode === "run") return machine.fuzz === null ? "supplied run" : "fuzz runs";
  return "off";
}
