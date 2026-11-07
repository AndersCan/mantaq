import { unhandledSends } from "./moves.ts";
import { coveredByAny } from "./schema.ts";
import type { VizMachine, VizStep } from "./schema.ts";

export type VizFindingKind = "handlerError" | "unhandledSend" | "unreachableState";

export interface VizFinding {
  kind: VizFindingKind;
  /** Id of the state the finding is about. */
  state: string;
  /** One line, the text the design gate reports. */
  message: string;
  /** Steps from a fresh actor that reach it. [] = the initial state. null = no known path. */
  steps: VizStep[] | null;
}

export const FINDING_KINDS: Readonly<Record<VizFindingKind, { title: string; sentence: string }>> =
  {
    handlerError: {
      title: "Handler throws",
      sentence:
        "Fuzzing sent this event in this state and the handler threw, so the actor ends up in its error state instead of where you meant it to go.",
    },
    unhandledSend: {
      title: "Event nobody handles",
      sentence:
        "An effect here sends an event this state has no handler for: an input is dropped without a trace, and an internal event puts the actor in its error state.",
    },
    unreachableState: {
      title: "Unreachable state",
      sentence:
        "No sequence of events leads here from the initial state: a transition into it is missing, or the state is not needed.",
    },
  };

/**
 * States no edge path leads to from the initial state. Empty when an undetermined
 * edge hides the answer. Region states are never reported: the graph does not
 * record where a region starts.
 */
export function unreachableStates(machine: VizMachine): string[] {
  const reached = new Set(
    machine.states
      .filter((state) => state.initial || state.region !== null)
      .map((state) => state.id),
  );
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

function pathTo(machine: VizMachine, id: string): VizStep[] | null {
  if (machine.states.some((state) => state.id === id && state.initial)) return [];
  let best: VizStep[] | null = null;
  for (const sequence of machine.fuzz?.corpus ?? []) {
    if (!sequence.discovered.includes(`state:${id}`)) continue;
    if (best === null || sequence.steps.length < best.length) best = sequence.steps;
  }
  return best;
}

/** Every design finding of a machine, with the state it concerns and the steps that reach it. */
export function machineFindings(machine: VizMachine): VizFinding[] {
  const thrown = (machine.fuzz?.errors ?? []).map((error): VizFinding => ({
    kind: "handlerError",
    state: error.from,
    message: `${error.event} in ${error.from} throws: ${error.message}`,
    steps: error.steps,
  }));
  const sends = machine.states.flatMap((state) =>
    unhandledSends(machine, state.id).map(({ effect, event }): VizFinding => ({
      kind: "unhandledSend",
      state: state.id,
      message: `effect ${effect} in ${state.id} sends ${event}, but ${state.id} has no handler for it`,
      steps: pathTo(machine, state.id),
    })),
  );
  const orphans = unreachableStates(machine).map((id): VizFinding => ({
    kind: "unreachableState",
    state: id,
    message: `state ${id} is declared but no path leads to it from the initial state`,
    steps: null,
  }));
  return [...thrown, ...sends, ...orphans];
}
