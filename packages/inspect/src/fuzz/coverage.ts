import { coveredByAny } from "@mantaq/viz";
import type { VizEdge, VizMachine, VizStep } from "@mantaq/viz";
import { execute } from "./run.ts";
import type { FuzzTarget, Observation, Trace } from "./run.ts";

/**
 * An `onAny` edge counts observations from every state it covers. A state's
 * own handler for the same event is not told apart: observations carry no
 * handler identity.
 */
function matches(edge: VizEdge, seen: Observation): boolean {
  const source = seen.from === edge.from || coveredByAny(edge.from, seen.from);
  if (!source || seen.event !== edge.event) return false;
  if (edge.kind === "stay") return !seen.transitioned;
  // Undetermined: any outcome of this handler counts.
  if (edge.to === null) return true;
  return seen.transitioned && seen.to === edge.to;
}

/** Times each edge was taken in `traces`; null for edges no handler drives (initial, effect). */
export function edgeHits(edge: VizEdge, traces: ReadonlyArray<Trace>): number | null {
  if (!driven(edge)) return null;
  return traces.reduce(
    (sum, trace) => sum + trace.observations.filter((seen) => matches(edge, seen)).length,
    0,
  );
}

/** Edges a run can take: not the initial edge, not effect self-loops. */
function driven(edge: VizEdge): boolean {
  return edge.kind !== "initial" && edge.kind !== "effect";
}

/**
 * Stateful `done` for `fuzz`: true once the runs seen so far reached every
 * state and every handler edge of `machine`, counted as the viz counts hits,
 * and every `must` feature (must-see expectations) was hit.
 */
export function coverageGoal(
  machine: VizMachine,
  must: ReadonlyArray<string> = [],
): (trace: Trace) => boolean {
  const states = new Set(machine.states.map((state) => state.id));
  const unmet = new Set(must);
  let edges = machine.edges.filter(driven);
  return (trace) => {
    for (const state of trace.visited) states.delete(state);
    for (const feature of trace.features) unmet.delete(feature);
    edges = edges.filter((edge) => !trace.observations.some((seen) => matches(edge, seen)));
    return states.size === 0 && edges.length === 0 && unmet.size === 0;
  };
}

function edgeName(edge: VizEdge): string {
  return `${edge.from} -${edge.event}-> ${edge.kind === "stay" ? "(stay)" : (edge.to ?? "?")}`;
}

/**
 * States and edges of a fuzzed machine with zero hits. An edge out of an
 * unreached state is left out: reaching the state comes first.
 */
export function unreached(machine: VizMachine): string[] {
  const states = machine.states.filter((state) => state.coverage?.hits === 0).map((s) => s.id);
  const missing = new Set(states);
  const edges = machine.edges
    .filter((edge) => driven(edge) && edge.coverage?.hits === 0 && !missing.has(edge.from))
    .map(edgeName);
  return [...states, ...edges];
}

export function stateVisits(state: string, traces: ReadonlyArray<Trace>): number {
  return traces.reduce(
    (sum, trace) => sum + trace.visited.filter((visited) => visited === state).length,
    0,
  );
}

/**
 * Fill `tested` from replaying test sequences (each from a fresh actor).
 * Lets the viewer show what the tests never exercise, next to what fuzzing reached.
 */
export function withTestCoverage(
  target: FuzzTarget,
  machine: VizMachine,
  sequences: ReadonlyArray<ReadonlyArray<VizStep>>,
): VizMachine {
  const traces = sequences.map((steps) => execute(target, steps));
  return {
    ...machine,
    states: machine.states.map((state) => ({
      ...state,
      tested: { hits: stateVisits(state.id, traces) },
    })),
    edges: machine.edges.map((edge) => {
      const hits = edgeHits(edge, traces);
      return { ...edge, tested: hits === null ? null : { hits } };
    }),
  };
}
