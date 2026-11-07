import { machineFindings } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
export { unreachableStates } from "@mantaq/viz";
import { inspect } from "./inspect.ts";
import type { InspectTarget } from "./inspect.ts";

/** Design errors of an inspected machine, one line each. Unreached edges and routing warnings are not errors. */
export function designErrors(machine: VizMachine): string[] {
  return machineFindings(machine).map((finding) => finding.message);
}

/**
 * Call from a test: throws when fuzzing finds a handler or effect that throws,
 * an effect sends an event its state does not handle, or a declared state has
 * no path from the initial state. Runs are seeded, so the result is stable.
 */
export function expectNoDesignErrors(target: InspectTarget): void {
  const { machine } = inspect(target);
  const errors = designErrors(machine);
  if (errors.length === 0) return;
  throw new Error(
    `${machine.id} has ${errors.length} design error${errors.length === 1 ? "" : "s"}:\n${errors.map((each) => `  - ${each}`).join("\n")}`,
  );
}
