/**
 * Viz document schema. Bump `VIZ_SCHEMA_VERSION` on any breaking change.
 * Everything not observable at runtime is `null`, never guessed.
 */
export const VIZ_SCHEMA_VERSION = 8;

/**
 * Edge source of an `onAny` registration: any non-final state of the machine,
 * or `region.*` inside a region. Never listed in `states`.
 */
export const ANY_STATE = "*";

/** Region prefix of a state id (`""` at the root). */
export function scopeOf(id: string): string {
  const cut = id.lastIndexOf(".");
  return cut === -1 ? "" : id.slice(0, cut);
}

export function isAnyState(id: string): boolean {
  return id === ANY_STATE || id.endsWith(`.${ANY_STATE}`);
}

/** True when `stateId` is one of the states an `anyId` source stands for. */
export function coveredByAny(anyId: string, stateId: string): boolean {
  return isAnyState(anyId) && !isAnyState(stateId) && scopeOf(anyId) === scopeOf(stateId);
}

export interface VizCoverage {
  hits: number;
}

/** An effect a state runs on entry. Effects never transition; the events they send do. */
export interface VizEffect {
  name: string;
  /** Event ids from the effect's `sends` declaration. null = not declared. */
  sends: string[] | null;
}

export interface VizState {
  /** Path-prefixed id, e.g. `payment` or `region1.childA`. */
  id: string;
  label: string;
  /** Region path this state belongs to, or null for the root machine. */
  region: string | null;
  initial: boolean;
  final: boolean;
  /** Effects this state runs on entry, in registration order. */
  effects: VizEffect[];
  /** Visits in the supplied run (history or fuzz corpus replay). null = no run. */
  coverage: VizCoverage | null;
  /** Visits by the supplied test sequences. null = no tests supplied. */
  tested: VizCoverage | null;
  /** Leading JSDoc of the `state(...)` declaration. null = undocumented or AST not run. */
  doc: string | null;
}

export interface VizEvent {
  id: string;
  internal: boolean;
  /** Leading JSDoc of the `event(...)` declaration. null = undocumented or AST not run. */
  doc: string | null;
  /** Payload types are erased at runtime; always null. */
  payloadType: null;
}

/**
 * `stay`: the event was handled but the state did not change. Declared by a
 * registration without `to`, or observed while fuzzing.
 */
export type VizEdgeKind = "initial" | "transition" | "effect" | "stay";

/**
 * `declared`: from the builder's `to` list, so the type checker vouches for it.
 * `probe`: an actor without declarations, found by synthetic traversal.
 * `fuzz`: observed only while fuzzing.
 */
export type VizEdgeOrigin = "declared" | "probe" | "fuzz";

export interface VizLocation {
  /** POSIX path relative to the analysis root. */
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

/** Where a handler return path goes. `stay` = no `state` in the result. */
export type VizBranchTarget =
  | { kind: "state"; state: string }
  | { kind: "stay" }
  | { kind: "unresolved"; text: string };

export interface VizBranch {
  /** Source text of each condition on the path, outermost first; `!(...)` = else side. */
  conditions: string[];
  target: VizBranchTarget;
}

/** `payload.amount > 50000` style comparison against a literal, for search guidance. */
export interface VizComparison {
  source: "payload" | "context";
  /** Dotted path below payload / context, e.g. `result.reservationId`. */
  path: string;
  operator: "<" | "<=" | ">" | ">=" | "===" | "!==" | "==" | "!=";
  literal: number | string | boolean;
}

/**
 * Static reading of the handler behind an edge (TypeScript compiler API).
 * Annotates runtime edges; never creates them.
 */
export type VizExplanation =
  | {
      status: "analyzed";
      location: VizLocation;
      registration: "on" | "onAny";
      branches: VizBranch[];
      payloadReads: string[];
      contextReads: string[];
      contextWrites: string[];
      /** Reads `<actor>.state`: target depends on live state, which probing cannot see. */
      readsActorState: boolean;
      comparisons: VizComparison[];
      literals: Array<number | string>;
    }
  | {
      status: "not_analyzed";
      location: VizLocation | null;
      reason: string;
      /** First lines of the source, when there is any. */
      snippet: string | null;
    };

export interface VizEdge {
  id: string;
  from: string;
  /** Event id; empty string for the initial edge. */
  event: string;
  /** null = handler target depends on payload or context (undetermined). */
  to: string | null;
  kind: VizEdgeKind;
  origin: VizEdgeOrigin;
  emits: string[];
  /** Sample-context names under which this edge was observed. */
  contexts: string[];
  /** null = no handler behind this edge (initial, effect) or analysis not run. */
  explanation: VizExplanation | null;
  /** Leading JSDoc of the `m.on` / `m.onAny` call. null = undocumented, no handler, or AST not run. */
  doc: string | null;
  /** Times taken in the supplied run (history or fuzz corpus replay). null = no run. */
  coverage: VizCoverage | null;
  /** Times taken by the supplied test sequences. null = no tests supplied. */
  tested: VizCoverage | null;
}

export interface VizMachine {
  id: string;
  initial: string | null;
  /** Region paths, sorted. Empty for flat machines. */
  regions: string[];
  states: VizState[];
  events: VizEvent[];
  edges: VizEdge[];
  /** null = not fuzzed. */
  fuzz: VizFuzz | null;
}

export type VizJson = null | boolean | number | string | VizJson[] | { [key: string]: VizJson };

/** One input to a machine: an event (`send` for inputs, `inject` for internal) or a clock advance. */
export type VizStep =
  | { kind: "event"; event: string; payload: VizJson }
  | { kind: "advance"; ms: number };

/** What one step did: the actor moved, handled it without moving, or had no handler. */
export type VizLiveOutcome = "transition" | "stay" | "ignored";

export interface VizLiveStep {
  from: string;
  event: string;
  to: string;
  outcome: VizLiveOutcome;
  /** Names of the effects the step ran. */
  effects: string[];
  context: VizJson;
  /** Message of a handler that threw; null when none did. */
  error: string | null;
}

export interface VizLiveTimer {
  id: string;
  ms: number;
  deadline: number;
  eventName: string | null;
}

/** Where a running actor is, after the steps in `steps`. */
export interface VizLiveState {
  state: string;
  steps: VizStep[];
  last: VizLiveStep | null;
  timers: VizLiveTimer[];
  context: VizJson;
}

/**
 * A running actor behind the viewer. JSON in, JSON out, so viz needs no core:
 * `@mantaq/inspect` implements it on the step function the fuzzer uses.
 */
export interface VizDriver {
  reset(): VizLiveState;
  step(step: VizStep): VizLiveState;
}

export interface VizFuzzSequence {
  /** Shrunk replayable sequence, starting from a fresh actor. */
  steps: VizStep[];
  /** Coverage features this sequence was kept for, e.g. `edge:a>go>b`. */
  discovered: string[];
}

/** A handler that threw: the actor entered its error state. */
export interface VizFuzzError {
  from: string;
  event: string;
  message: string;
  steps: VizStep[];
}

export interface VizFuzz {
  seed: number;
  iterations: number;
  corpus: VizFuzzSequence[];
  errors: VizFuzzError[];
}

export interface VizDocument {
  schemaVersion: typeof VIZ_SCHEMA_VERSION;
  machines: VizMachine[];
}
