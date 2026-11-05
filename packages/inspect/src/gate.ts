import { coveredByAny, unhandledSends } from "@mantaq/viz";
import type { VizMachine } from "@mantaq/viz";
import { inspect } from "./inspect.ts";
import type { InspectTarget } from "./inspect.ts";

/** States no edge path leads to from an initial state. Empty when an undetermined edge hides the answer. */
export function unreachableStates(machine: VizMachine): string[] {
  const reached = new Set(machine.states.filter((state) => state.initial).map((state) => state.id));
  const queue = [...reached];
  let undetermined = false;
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const from = next;
    for (const edge of machine.edges) {
      if (edge.kind === "effect" || (edge.from !== from && !coveredByAny(edge.from, from)))
        continue;
      if (edge.to === null) {
        undetermined = true;
        continue;
      }
      if (reached.has(edge.to)) continue;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  if (undetermined) return [];
  return machine.states.map((state) => state.id).filter((id) => !reached.has(id));
}

/** Design errors of an inspected machine, one line each. Unreached edges and routing warnings are not errors. */
export function designErrors(machine: VizMachine): string[] {
  const thrown = (machine.fuzz?.errors ?? []).map(
    (error) => `${error.event} in ${error.from} throws: ${error.message}`,
  );
  const sends = machine.states.flatMap((state) =>
    unhandledSends(machine, state.id).map(
      ({ effect, event }) =>
        `effect ${effect} in ${state.id} sends ${event}, but ${state.id} has no handler for it`,
    ),
  );
  const orphans = unreachableStates(machine).map(
    (id) => `state ${id} is declared but no path leads to it from the initial state`,
  );
  return [...thrown, ...sends, ...orphans];
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
