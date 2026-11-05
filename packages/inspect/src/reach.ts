import type { VizEdge, VizMachine } from "@mantaq/viz";
import { inspect } from "./inspect.ts";
import type { InspectTarget } from "./inspect.ts";

export interface ReachTransition {
  from: string;
  event: string;
  /** Omit to accept any target. */
  to?: string;
}

export interface ReachExpectation {
  states?: ReadonlyArray<string>;
  transitions?: ReadonlyArray<ReachTransition>;
}

function hitCount(coverage: { hits: number } | null): number {
  return coverage?.hits ?? 0;
}

/** Ids of the states a fuzz run or the supplied test sequences visited. */
export function reachedStates(machine: VizMachine): string[] {
  return machine.states
    .filter((state) => hitCount(state.coverage) + hitCount(state.tested) > 0)
    .map((state) => state.id);
}

function isTaken(edge: VizEdge): boolean {
  return hitCount(edge.coverage) + hitCount(edge.tested) > 0;
}

function describeTransition({ from, event, to }: ReachTransition): string {
  return to === undefined ? `${from} --${event}-->` : `${from} --${event}--> ${to}`;
}

/** What the expectation asks for and the machine did not reach, one line each. */
export function missedReach(machine: VizMachine, expected: ReachExpectation): string[] {
  const reached = new Set(reachedStates(machine));
  const states = (expected.states ?? []).map((id) => {
    if (!machine.states.some((state) => state.id === id)) return `state ${id} does not exist`;
    return reached.has(id) ? null : `state ${id} was not reached`;
  });
  const transitions = (expected.transitions ?? []).map((wanted) => {
    const matching = machine.edges.filter(
      (edge) =>
        edge.kind !== "effect" &&
        edge.kind !== "initial" &&
        edge.from === wanted.from &&
        edge.event === wanted.event &&
        (wanted.to === undefined || edge.to === wanted.to),
    );
    if (matching.length === 0) return `transition ${describeTransition(wanted)} does not exist`;
    return matching.some(isTaken) ? null : `transition ${describeTransition(wanted)} was not taken`;
  });
  return [...states, ...transitions].filter((line) => line !== null);
}

function failOnMiss(machine: VizMachine, misses: string[]): void {
  if (misses.length === 0) return;
  throw new Error(
    `${machine.id} missed ${misses.length} expected ${misses.length === 1 ? "reach" : "reaches"}:\n${misses.map((each) => `  - ${each}`).join("\n")}\nAdd an example run to \`tests\`, or raise \`fuzz.iterations\`, to cover it.`,
  );
}

/**
 * Call from a test: throws unless fuzzing or the target's `tests` visited every
 * listed state and took every listed transition. Reaching is proof; a miss only
 * says nothing got there yet.
 */
export function expectReached(target: InspectTarget, expected: ReachExpectation): void {
  const { machine } = inspect(target);
  failOnMiss(machine, missedReach(machine, expected));
}

/** Call from a test: throws unless fuzzing or the target's `tests` visited every declared state. */
export function expectAllStatesReached(target: InspectTarget): void {
  const { machine } = inspect(target);
  failOnMiss(machine, missedReach(machine, { states: machine.states.map((state) => state.id) }));
}
