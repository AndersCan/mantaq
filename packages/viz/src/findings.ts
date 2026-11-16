import { unhandledSends } from "./moves.ts";
import { coveredByAny, isAnyState } from "./schema.ts";
import type { VizMachine, VizStep } from "./schema.ts";

export type VizFindingKind =
  | "handlerError"
  | "neverSee"
  | "mustSee"
  | "unhandledSend"
  | "deadEnd"
  | "unreachableState"
  | "unhandledEvent"
  | "vagueName"
  | "undocumented";

export interface VizFinding {
  kind: VizFindingKind;
  /** State the ! mark sits on. null = about the whole machine (an event-level finding): no mark. */
  state: string | null;
  /** Event the finding is about, when there is one. */
  event: string | null;
  /** Naming notes (vagueName, undocumented): not bugs. No ! mark, not in the banner count; the gate still reports them. */
  note: boolean;
  /** Headline in the machine's own names, no trailing period: "refunded can never be reached". */
  title: string;
  /** Why it is true, in the machine's names; one or two sentences, ends with a period. */
  proof: string;
  /** What to change; one sentence, ends with a period. */
  fix: string;
  /** `${title}. ${proof} ${fix}`: the design gate's line. */
  message: string;
  /** Steps from a fresh actor that reach it. [] = the initial state. null = no known path. */
  steps: VizStep[] | null;
  /** Why there is nothing to replay. null exactly when steps has at least one step. */
  noReplay: string | null;
}

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

/** `a`, `a and b`, `a, b and c`; more than 6: the first 6 and the count of the rest. */
export function names(ids: ReadonlyArray<string>): string {
  if (ids.length > 6) return `${ids.slice(0, 6).join(", ")} and ${ids.length - 6} more`;
  if (ids.length < 2) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

interface Draft {
  kind: VizFindingKind;
  state: string | null;
  event: string | null;
  title: string;
  proof: string;
  fix: string;
  steps: VizStep[] | null;
  noReplay?: string;
}

const NOTES: ReadonlySet<VizFindingKind> = new Set(["vagueName", "undocumented"]);

function noReplayText(draft: Draft): string {
  const subject = draft.state ?? draft.event ?? "";
  if (draft.steps !== null && draft.steps.length === 0) {
    return `${subject} is the start state, so there is nothing to replay.`;
  }
  if (draft.noReplay !== undefined) return draft.noReplay;
  if (NOTES.has(draft.kind)) return "Found by reading the machine file, not by a run.";
  return `No fuzz run reached ${subject}, so there is no path to replay.`;
}

function finding(draft: Draft): VizFinding {
  const replayable = draft.steps !== null && draft.steps.length > 0;
  return {
    kind: draft.kind,
    state: draft.state,
    event: draft.event,
    note: NOTES.has(draft.kind),
    title: draft.title,
    proof: draft.proof,
    fix: draft.fix,
    message: `${draft.title}. ${draft.proof} ${draft.fix}`,
    steps: draft.steps,
    noReplay: replayable ? null : noReplayText(draft),
  };
}

function incomingInto(machine: VizMachine, id: string) {
  const seen = new Set<string>();
  return machine.edges.filter((edge) => {
    if (edge.kind !== "transition" || edge.to !== id || edge.from === id) return false;
    const key = `${edge.event}\u0000${edge.from}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function arrowText(edge: { event: string; from: string }): string {
  return isAnyState(edge.from) ? `${edge.event} from any state` : `${edge.event} in ${edge.from}`;
}

function namingFindings(machine: VizMachine): VizFinding[] {
  if (!sourceRead(machine)) return [];
  const vague: VizFinding[] = [];
  const undocumented: VizFinding[] = [];
  for (const state of machine.states) {
    const words = vagueWords(state.id, true);
    if (words === null) continue;
    vague.push(
      finding({
        kind: "vagueName",
        state: state.id,
        event: null,
        title: `${state.id} is a vague name`,
        proof: `Every word in ${state.id} (${words.join(", ")}) is a generic status word, so the diagram does not say what happens there.`,
        fix: "Name what the person sees, like showingPhotos.",
        steps: null,
      }),
    );
  }
  for (const event of machine.events) {
    const words = vagueWords(event.id, false);
    if (words === null) continue;
    vague.push(
      finding({
        kind: "vagueName",
        state: null,
        event: event.id,
        title: `${event.id} is a vague name`,
        proof: `Every word in ${event.id} (${words.join(", ")}) is a generic status word, so the diagram does not say what happened.`,
        fix: "Name what happened, like photosLoaded.",
        steps: null,
      }),
    );
  }
  for (const state of machine.states) {
    if (!missingDoc(state.doc)) continue;
    const local = state.id.split(".").at(-1) ?? state.id;
    undocumented.push(
      finding({
        kind: "undocumented",
        state: state.id,
        event: null,
        title: `${state.id} has no description`,
        proof: `There is no /** */ comment above state("${local}"), so the page shows nothing under its name.`,
        fix: `Add /** what the person sees here */ above state("${local}").`,
        steps: null,
      }),
    );
  }
  for (const event of machine.events) {
    if (!missingDoc(event.doc)) continue;
    undocumented.push(
      finding({
        kind: "undocumented",
        state: null,
        event: event.id,
        title: `${event.id} has no description`,
        proof: `There is no /** */ comment above event("${event.id}"), so the page shows nothing under its name.`,
        fix: `Add /** what happened */ above event("${event.id}").`,
        steps: null,
      }),
    );
  }
  return [...vague, ...undocumented, ...arrowFindings(machine)];
}

type VizEdgeT = VizMachine["edges"][number];

function isHandlerEdge(edge: VizEdgeT): boolean {
  return edge.kind === "transition" || edge.kind === "stay";
}

function groupKey(edge: VizEdgeT): string | null {
  const location = edge.explanation?.location;
  if (!location) return null;
  return `${location.file}:${location.line}:${location.column}\u0000${edge.event}`;
}

function handlerFinding(edge: VizEdgeT, anyInGroup: boolean): VizFinding {
  const location = edge.explanation?.location;
  const where = `${location?.file}:${location?.line}`;
  if (anyInGroup) {
    return finding({
      kind: "undocumented",
      state: null,
      event: edge.event,
      title: `${edge.event} from any state has no description`,
      proof: `The m.onAny handler for ${edge.event} (${where}) has no /** */ comment, so the Step list shows nothing under ${edge.event}.`,
      fix: "Add /** what happened and what the machine does next */ right before that m.onAny.",
      steps: null,
    });
  }
  return finding({
    kind: "undocumented",
    state: edge.from,
    event: edge.event,
    title: `${edge.event} in ${edge.from} has no description`,
    proof: `The handler for ${edge.event} in ${edge.from} (${where}) has no /** */ comment, so the Step list shows nothing under ${edge.event}.`,
    fix: "Add /** what happened and what the machine does next */ right before that m.on, or before its .on in a chain.",
    steps: null,
  });
}

function effectsFinding(state: VizMachine["states"][number]): VizFinding {
  const list = names(state.effects.map((effect) => effect.name));
  const local = state.id.split(".").at(-1) ?? state.id;
  return finding({
    kind: "undocumented",
    state: state.id,
    event: null,
    title: `${list} in ${state.id} ${state.effects.length === 1 ? "has" : "have"} no description`,
    proof: `No m.effect(${local}, …) call has a /** */ comment, so the Step list shows nothing under "Entering ${state.id} runs:".`,
    fix: `Add /** what happens while ${state.id} runs ${list} */ right before m.effect(${local}, …).`,
    steps: null,
  });
}

function arrowFindings(machine: VizMachine): VizFinding[] {
  const undescribed = machine.edges.filter((edge) => missingDoc(edge.doc));
  const anyGroups = new Set(
    undescribed.filter((edge) => isHandlerEdge(edge) && isAnyState(edge.from)).map(groupKey),
  );
  const out: VizFinding[] = [];
  const seen = new Set<string>();
  for (const edge of undescribed) {
    if (edge.kind === "effect") {
      const state = machine.states.find((candidate) => candidate.id === edge.from);
      if (!state || state.effects.length === 0 || seen.has(`effect\u0000${edge.from}`)) continue;
      seen.add(`effect\u0000${edge.from}`);
      out.push(effectsFinding(state));
      continue;
    }
    const group = groupKey(edge);
    if (!isHandlerEdge(edge) || group === null) continue;
    const anyInGroup = anyGroups.has(group);
    const key = anyInGroup ? group : `${group}\u0000${edge.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(handlerFinding(edge, anyInGroup));
  }
  return out;
}

/** Regions whose start state the graph records. */
function startedRegions(machine: VizMachine): Set<string | null> {
  return new Set(
    machine.states.filter((state) => state.initial && state.region !== null).map((s) => s.region),
  );
}

function reachability(machine: VizMachine): { reached: Set<string>; undetermined: boolean } {
  const started = startedRegions(machine);
  const reached = new Set(
    machine.states
      .filter((state) => state.initial || (state.region !== null && !started.has(state.region)))
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
  return { reached, undetermined };
}

/**
 * States no edge path leads to from the initial state. Empty when an undetermined
 * edge hides the answer. A region is walked from its own start state; a region
 * whose start is not recorded counts as fully reached.
 */
export function unreachableStates(machine: VizMachine): string[] {
  const { reached, undetermined } = reachability(machine);
  if (undetermined) return [];
  return machine.states.map((state) => state.id).filter((id) => !reached.has(id));
}

/** The shortest fuzz walk that reaches state `id`; [] for the initial state, null when none is known. */
export function pathTo(machine: VizMachine, id: string): VizStep[] | null {
  if (machine.states.some((state) => state.id === id && state.initial)) return [];
  let best: VizStep[] | null = null;
  for (const sequence of machine.fuzz?.corpus ?? []) {
    if (!sequence.discovered.includes(`state:${id}`)) continue;
    if (best === null || sequence.steps.length < best.length) best = sequence.steps;
  }
  return best;
}

function fuzzFindings(machine: VizMachine): VizFinding[] {
  const thrown = (machine.fuzz?.errors ?? []).map((error) =>
    finding({
      kind: "handlerError",
      state: error.from,
      event: error.event,
      title: `${error.event} in ${error.from} throws`,
      proof: `Fuzzing sent ${error.event} in ${error.from} and the handler threw "${error.message}", so the actor went to __error.`,
      fix: "Handle the failure in the handler and return a state for it.",
      steps: error.steps,
    }),
  );
  const expectations = machine.fuzz?.failedExpectations ?? [];
  const never = expectations
    .filter((f) => f.kind === "neverSee")
    .map((f) =>
      finding({
        kind: "neverSee",
        state: f.state,
        event: null,
        title: `${f.state} was reached with ${f.match}`,
        proof: `The expectations block says ${f.state} must never see ${f.match}, and a fuzz run got there.`,
        fix: `Reject that input in the handler that leads to ${f.state}, or change the expectation.`,
        steps: f.steps,
      }),
    );
  const must = expectations
    .filter((f) => f.kind === "mustSee")
    .map((f) =>
      finding({
        kind: "mustSee",
        state: f.state,
        event: null,
        title: `${f.state} was never reached with ${f.match}`,
        proof: `The expectations block says some run must reach ${f.state} with ${f.match}, and none of ${machine.fuzz?.iterations ?? 0} fuzz runs did.`,
        fix: "Add a recorded run to tests that gets there, or check what blocks the path.",
        steps: null,
        noReplay: "No run got there, so there is nothing to replay.",
      }),
    );
  return [...thrown, ...never, ...must];
}

function sendFindings(machine: VizMachine): VizFinding[] {
  return machine.states.flatMap((state) =>
    unhandledSends(machine, state.id).map(({ effect, event }) => {
      const declared = machine.events.find((each) => each.id === event);
      const proof =
        declared === undefined
          ? `When ${effect} sends ${event} in ${state.id}, nothing handles it.`
          : declared.internal
            ? `When ${effect} sends ${event} in ${state.id}, the actor goes to __error.`
            : `When ${effect} sends ${event} in ${state.id}, it is dropped and the machine stays in ${state.id}.`;
      return finding({
        kind: "unhandledSend",
        state: state.id,
        event,
        title: `${effect} sends ${event}, but ${state.id} has no handler for it`,
        proof,
        fix: `Handle ${event} in ${state.id}, or remove ${event} from the sends of ${effect}.`,
        steps: pathTo(machine, state.id),
      });
    }),
  );
}

function eventFindings(machine: VizMachine, sends: ReadonlyArray<VizFinding>): VizFinding[] {
  const sentUnhandled = new Set(sends.map((each) => each.event));
  return machine.events
    .filter(
      (event) =>
        !sentUnhandled.has(event.id) &&
        !machine.edges.some(
          (edge) => edge.event === event.id && (edge.kind === "transition" || edge.kind === "stay"),
        ),
    )
    .map((event) =>
      finding({
        kind: "unhandledEvent",
        state: null,
        event: event.id,
        title: `${event.id} is declared but no state handles it`,
        proof: event.internal
          ? `${event.id} is an internal event of ${machine.id}, but no state has a handler for it: if an effect sends it, the actor goes to __error.`
          : `${event.id} is an input of ${machine.id}, but no state has a handler for it, so sending it does nothing.`,
        fix: `Handle ${event.id} in a state, or remove it from ${event.internal ? "internal" : "inputs"}.`,
        steps: null,
        noReplay: `No state handles ${event.id}, so there is nothing to replay.`,
      }),
    );
}

/** Every design finding of a machine, with the state it concerns and the steps that reach it. */
export function machineFindings(machine: VizMachine): VizFinding[] {
  const sends = sendFindings(machine);
  const unreachable = unreachableStates(machine);
  const { reached } = reachability(machine);
  const reachedRoot = machine.states
    .filter((state) => reached.has(state.id) && state.region === null)
    .map((state) => state.id);
  const reachSentence =
    machine.initial === null
      ? ""
      : ` From ${machine.initial}, the machine can only reach ${names(reachedRoot)}.`;
  const started = startedRegions(machine);
  const dead = machine.states
    .filter(
      (state) =>
        !state.final &&
        (state.region === null || started.has(state.region)) &&
        state.effects.length === 0 &&
        !unreachable.includes(state.id) &&
        !machine.edges.some((edge) => edge.from === state.id || coveredByAny(edge.from, state.id)),
    )
    .map((state) => {
      const incoming = incomingInto(machine, state.id).map(arrowText);
      const how =
        state.initial || incoming.length === 0
          ? `The machine starts in ${state.id}`
          : `The machine gets to ${state.id} by ${names(incoming)}`;
      return finding({
        kind: "deadEnd",
        state: state.id,
        event: null,
        title: `${state.id} is a dead end`,
        proof: `${how}, but nothing can happen there: no event is handled, no effect runs, and it is not final.`,
        fix: `Handle an event in ${state.id}, or make it final.`,
        steps: pathTo(machine, state.id),
      });
    });
  const orphans = unreachable.map((id) => {
    const inRegion = machine.states.some((state) => state.id === id && state.region !== null);
    const incoming = incomingInto(machine, id);
    const sources = [...new Set(incoming.map((edge) => edge.from))];
    const only =
      incoming.length === 0
        ? {
            proof: `No transition leads into ${id}.`,
            fix: `Add a transition into ${id}, or remove it.`,
          }
        : {
            proof: `Only ${names(incoming.map(arrowText))} ${incoming.length === 1 ? "leads" : "lead"} into ${id}, and ${names(sources)} can never be reached either.`,
            fix: `Make ${names(sources)} reachable, or remove ${id}.`,
          };
    return finding({
      kind: "unreachableState",
      state: id,
      event: null,
      title: `${id} can never be reached`,
      proof: `${only.proof}${inRegion ? "" : reachSentence}`,
      fix: only.fix,
      steps: null,
      noReplay: `Nothing reaches ${id}, so there is nothing to replay.`,
    });
  });
  return [
    ...fuzzFindings(machine),
    ...sends,
    ...dead,
    ...orphans,
    ...eventFindings(machine, sends),
    ...namingFindings(machine),
  ];
}
