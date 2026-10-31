import { coveredByAny } from "../schema.ts";
import type { AtlasEdge, AtlasMachine, AtlasStep } from "../schema.ts";
import { execute } from "./run.ts";
import type { FuzzTarget, Observation, Trace } from "./run.ts";

/**
 * An `onAny` edge counts observations from every state it covers. A state's
 * own handler for the same event is not told apart: observations carry no
 * handler identity.
 */
function matches(edge: AtlasEdge, seen: Observation): boolean {
  const source = seen.from === edge.from || coveredByAny(edge.from, seen.from);
  if (!source || seen.event !== edge.event) return false;
  if (edge.kind === "stay") return !seen.transitioned;
  // Undetermined: any outcome of this handler counts.
  if (edge.to === null) return true;
  return seen.transitioned && seen.to === edge.to;
}

/** Times each edge was taken in `traces`; null for edges no handler drives (initial, effect). */
export function edgeHits(edge: AtlasEdge, traces: ReadonlyArray<Trace>): number | null {
  if (edge.kind === "initial" || edge.kind === "effect") return null;
  return traces.reduce(
    (sum, trace) => sum + trace.observations.filter((seen) => matches(edge, seen)).length,
    0,
  );
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
  machine: AtlasMachine,
  sequences: ReadonlyArray<ReadonlyArray<AtlasStep>>,
): AtlasMachine {
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
