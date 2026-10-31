import type { AtlasCoverage, AtlasMachine } from "../schema.ts";

/** Which hit counts the overlay dims by: the run (fuzz or history) or the test sequences. */
export type CoverageMode = "off" | "run" | "tests";

interface Measured {
  coverage: AtlasCoverage | null;
  tested: AtlasCoverage | null;
}

function items(machine: AtlasMachine): Measured[] {
  return [...machine.states, ...machine.edges];
}

/** Modes this machine has data for, best first: tests answer "what is untested?". */
export function availableModes(machine: AtlasMachine): CoverageMode[] {
  const modes: CoverageMode[] = [];
  if (items(machine).some((item) => item.tested !== null)) modes.push("tests");
  if (items(machine).some((item) => item.coverage !== null)) modes.push("run");
  return modes;
}

export function measure(mode: CoverageMode, item: Measured): AtlasCoverage | null {
  if (mode === "run") return item.coverage;
  if (mode === "tests") return item.tested;
  return null;
}

export function modeLabel(mode: CoverageMode, machine: AtlasMachine): string {
  if (mode === "tests") return "example tests";
  if (mode === "run") return machine.fuzz === null ? "supplied run" : "fuzz runs";
  return "off";
}

/** Legend text for a dimmed element: what "unreached" means for this source. */
export function unreachedText(mode: CoverageMode, machine: AtlasMachine): string {
  if (mode === "tests") return "dimmed and dashed: no test exercises this";
  if (machine.fuzz === null) return "dimmed and dashed: never taken in the supplied run";
  return "dimmed and dashed: never observed while fuzzing (declared edges here may be unreachable)";
}
