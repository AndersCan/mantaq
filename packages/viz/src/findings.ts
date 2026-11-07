import { unhandledSends } from "./moves.ts";
import { coveredByAny } from "./schema.ts";
import type { VizMachine, VizStep } from "./schema.ts";

export type VizFindingKind =
  | "handlerError"
  | "neverSee"
  | "mustSee"
  | "unhandledSend"
  | "deadEnd"
  | "unreachableState"
  | "vagueName"
  | "undocumented";

export interface VizFinding {
  kind: VizFindingKind;
  /** Id of the state the finding is about. */
  state: string;
  /** One line, the text the design gate reports. */
  message: string;
  /** Steps from a fresh actor that reach it. [] = the initial state. null = no known path. */
  steps: VizStep[] | null;
}

export const FINDING_KINDS: Readonly<
  Record<VizFindingKind, { title: string; sentence: string; noSteps: string }>
> = {
  handlerError: {
    title: "Handler throws",
    sentence:
      "Fuzzing sent this event in this state and the handler threw, so the actor ends up in its error state instead of where you meant it to go.",
    noSteps: "No fuzz run reached it.",
  },
  neverSee: {
    title: "Never-see context reached",
    sentence:
      "A fuzz run reached this state with a context the machine file marks as a bug here (neverSee).",
    noSteps: "No fuzz run reached it.",
  },
  mustSee: {
    title: "Must-see context missed",
    sentence:
      "No fuzz run reached this state with a context the machine file says some run must reach (mustSee). A path to it is missing or blocked, or the fuzzer needs a recorded test run that gets there.",
    noSteps: "No fuzz run reached this context.",
  },
  unhandledSend: {
    title: "Event nobody handles",
    sentence:
      "An effect here sends an event this state has no handler for: an input is dropped without a trace, and an internal event puts the actor in its error state.",
    noSteps: "No fuzz run reached this state.",
  },
  deadEnd: {
    title: "Dead end",
    sentence:
      "The actor can get here, but nothing can happen next: no event is handled, no effect runs, and the state is not final. A way out is missing, or the state should be final.",
    noSteps: "No fuzz run reached this state.",
  },
  unreachableState: {
    title: "Unreachable state",
    sentence:
      "No sequence of events leads here from the initial state: a transition into it is missing, or the state is not needed.",
    noSteps: "No event path reaches this state.",
  },
  vagueName: {
    title: "Vague name",
    sentence:
      "Every word in this name is a generic status word, so it says how something went but not what. Someone reading only the diagram cannot tell what happens here. Name the thing: what the person sees, or what happened.",
    noSteps: "Found by reading the machine file, not by a run.",
  },
  undocumented: {
    title: "No description",
    sentence:
      "This state or event has no /** */ comment above its declaration, so the page has nothing to show under its name. Say in one line what the person sees, or what happened.",
    noSteps: "Found by reading the machine file, not by a run.",
  },
};

// Status words that say how, not what. A name made only of these is vague.
const VAGUE_WORDS: ReadonlySet<string> = new Set(
  "ok ready idle loading loaded error failed failure success succeeded done finished complete completed pending busy active waiting start started init status result data update updated change changed act acted".split(
    " ",
  ),
);

function nameWords(name: string, isState: boolean): string[] {
  const whole = isState ? (name.split(".").at(-1) ?? name) : name;
  return whole
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

function vagueWords(name: string, isState: boolean): string[] | null {
  const words = nameWords(name, isState);
  return words.length > 0 && words.every((word) => VAGUE_WORDS.has(word)) ? words : null;
}

function sourceRead(machine: VizMachine): boolean {
  return (
    machine.edges.some((edge) => edge.explanation?.status === "analyzed") ||
    machine.states.some((state) => typeof state.doc === "string") ||
    machine.events.some((event) => typeof event.doc === "string")
  );
}

function missingDoc(doc: string | null): boolean {
  return typeof doc !== "string" || doc.trim() === "";
}

function eventState(machine: VizMachine, eventId: string): string {
  const found = machine.states.find((state) =>
    machine.edges.some(
      (edge) =>
        edge.event === eventId &&
        (edge.kind === "transition" || edge.kind === "stay") &&
        (edge.from === state.id || coveredByAny(edge.from, state.id)),
    ),
  );
  return found?.id ?? machine.initial ?? "";
}

function namingFindings(machine: VizMachine): VizFinding[] {
  if (!sourceRead(machine)) return [];
  const vague: VizFinding[] = [];
  const undocumented: VizFinding[] = [];
  for (const state of machine.states) {
    const words = vagueWords(state.id, true);
    if (words === null) continue;
    vague.push({
      kind: "vagueName",
      state: state.id,
      message: `state ${state.id} has a vague name (only generic words: ${words.join(", ")}); name what the person sees, like showingPhotos`,
      steps: null,
    });
  }
  for (const event of machine.events) {
    const words = vagueWords(event.id, false);
    if (words === null) continue;
    vague.push({
      kind: "vagueName",
      state: eventState(machine, event.id),
      message: `event ${event.id} has a vague name (only generic words: ${words.join(", ")}); name what happened, like photosLoaded`,
      steps: null,
    });
  }
  for (const state of machine.states) {
    if (!missingDoc(state.doc)) continue;
    const local = state.id.split(".").at(-1) ?? state.id;
    undocumented.push({
      kind: "undocumented",
      state: state.id,
      message: `state ${state.id} has no doc comment: add /** what the person sees here */ above state("${local}")`,
      steps: null,
    });
  }
  for (const event of machine.events) {
    if (!missingDoc(event.doc)) continue;
    undocumented.push({
      kind: "undocumented",
      state: eventState(machine, event.id),
      message: `event ${event.id} has no doc comment: add /** what happened */ above event("${event.id}")`,
      steps: null,
    });
  }
  return [...vague, ...undocumented];
}

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
  const expectations = machine.fuzz?.failedExpectations ?? [];
  const never = expectations
    .filter((f) => f.kind === "neverSee")
    .map((f): VizFinding => ({
      kind: "neverSee",
      state: f.state,
      message: `state ${f.state} reached never-see context ${f.match}`,
      steps: f.steps,
    }));
  const must = expectations
    .filter((f) => f.kind === "mustSee")
    .map((f): VizFinding => ({
      kind: "mustSee",
      state: f.state,
      message: `state ${f.state} never reached must-see context ${f.match} in ${machine.fuzz?.iterations ?? 0} fuzz runs`,
      steps: null,
    }));
  const sends = machine.states.flatMap((state) =>
    unhandledSends(machine, state.id).map(({ effect, event }): VizFinding => ({
      kind: "unhandledSend",
      state: state.id,
      message: `effect ${effect} in ${state.id} sends ${event}, but ${state.id} has no handler for it`,
      steps: pathTo(machine, state.id),
    })),
  );
  const unreachable = unreachableStates(machine);
  const dead = machine.states
    .filter(
      (state) =>
        !state.final &&
        state.region === null &&
        state.effects.length === 0 &&
        !unreachable.includes(state.id) &&
        !machine.edges.some((edge) => edge.from === state.id || coveredByAny(edge.from, state.id)),
    )
    .map((state): VizFinding => ({
      kind: "deadEnd",
      state: state.id,
      message: `state ${state.id} has no way out and is not final`,
      steps: pathTo(machine, state.id),
    }));
  const orphans = unreachable.map((id): VizFinding => ({
    kind: "unreachableState",
    state: id,
    message: `state ${id} is declared but no path leads to it from the initial state`,
    steps: null,
  }));
  return [...thrown, ...never, ...must, ...sends, ...dead, ...orphans, ...namingFindings(machine)];
}
