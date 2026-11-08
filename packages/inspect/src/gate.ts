import { machineFindings } from "@mantaq/viz";
import type { VizMachine, VizStep } from "@mantaq/viz";
export { unreachableStates } from "@mantaq/viz";
import { inspect } from "./inspect.ts";
import type { InspectTarget } from "./inspect.ts";

/** Design errors of an inspected machine, one line each. Unreached edges and routing warnings are not errors. */
export function designErrors(machine: VizMachine): string[] {
  return machineFindings(machine).map((finding) => finding.message);
}

function stepText(step: VizStep): string {
  if (step.kind === "advance") return `advance ${step.ms}ms`;
  return step.payload === null ? step.event : `${step.event} ${JSON.stringify(step.payload)}`;
}

/** One line per finding, plus the events that lead there for fuzz-found ones. */
export function findingLines(machine: VizMachine): string[] {
  return machineFindings(machine).flatMap((finding) => {
    const line = `  - ${finding.message}`;
    if (finding.steps === null || finding.steps.length === 0) return [line];
    return [line, `    after: ${finding.steps.map(stepText).join(" → ")}`];
  });
}

/**
 * Call from a test: throws when fuzzing finds a handler or effect that throws,
 * an effect sends an event its state does not handle, a declared state has
 * no path from the initial state, or a declared event has no state that handles it. With `source`, it also throws on a state or
 * event whose name is only generic words (ok, loading, done...) or that has no
 * doc comment, and on a handler or a state's effects with no doc comment. Runs are seeded, so the result is stable.
 */
export function expectNoDesignErrors(target: InspectTarget): void {
  const { machine } = inspect(target);
  const errors = designErrors(machine);
  if (errors.length === 0) return;
  throw new Error(
    `${machine.id} has ${errors.length} design error${errors.length === 1 ? "" : "s"}:\n${findingLines(machine).join("\n")}`,
  );
}
