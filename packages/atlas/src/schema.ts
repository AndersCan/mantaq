/**
 * Atlas document schema. Bump `ATLAS_SCHEMA_VERSION` on any breaking change.
 * Everything not observable at runtime is `null`, never guessed.
 */
export const ATLAS_SCHEMA_VERSION = 4;

export interface AtlasCoverage {
  hits: number;
}

export interface AtlasState {
  /** Path-prefixed id, e.g. `payment` or `region1.childA`. */
  id: string;
  label: string;
  /** Region path this state belongs to, or null for the root machine. */
  region: string | null;
  initial: boolean;
  final: boolean;
  /** Visits in the supplied run (history or fuzz corpus replay). null = no run. */
  coverage: AtlasCoverage | null;
  /** Visits by the supplied test sequences. null = no tests supplied. */
  tested: AtlasCoverage | null;
}

export interface AtlasEvent {
  id: string;
  internal: boolean;
  /** Payload types are erased at runtime; always null. */
  payloadType: null;
}

/**
 * `stay`: the event was handled but the state did not change (handler returned
 * no target). Only observed by running the machine, never by probing.
 */
export type AtlasEdgeKind = "initial" | "transition" | "effect" | "stay";

/** `probe`: found by synthetic traversal. `fuzz`: observed only while fuzzing. */
export type AtlasEdgeOrigin = "probe" | "fuzz";

export interface AtlasLocation {
  /** POSIX path relative to the analysis root. */
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

/** Where a handler return path goes. `stay` = no `state` in the result. */
export type AtlasBranchTarget =
  | { kind: "state"; state: string }
  | { kind: "stay" }
  | { kind: "unresolved"; text: string };

export interface AtlasBranch {
  /** Source text of each condition on the path, outermost first; `!(...)` = else side. */
  conditions: string[];
  target: AtlasBranchTarget;
}

/** `payload.amount > 50000` style comparison against a literal, for search guidance. */
export interface AtlasComparison {
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
export type AtlasExplanation =
  | {
      status: "analyzed";
      location: AtlasLocation;
      registration: "on" | "onAny";
      branches: AtlasBranch[];
      payloadReads: string[];
      contextReads: string[];
      contextWrites: string[];
      /** Reads `<actor>.state`: target depends on live state, which probing cannot see. */
      readsActorState: boolean;
      comparisons: AtlasComparison[];
      literals: Array<number | string>;
    }
  | {
      status: "not_analyzed";
      location: AtlasLocation | null;
      reason: string;
      /** First lines of the source, when there is any. */
      snippet: string | null;
    };

export interface AtlasEdge {
  id: string;
  from: string;
  /** Event id; empty string for the initial edge. */
  event: string;
  /** null = handler target depends on payload or context (undetermined). */
  to: string | null;
  kind: AtlasEdgeKind;
  origin: AtlasEdgeOrigin;
  emits: string[];
  /** Sample-context names under which this edge was observed. */
  contexts: string[];
  /** null = no handler behind this edge (initial, effect) or analysis not run. */
  explanation: AtlasExplanation | null;
  /** Times taken in the supplied run (history or fuzz corpus replay). null = no run. */
  coverage: AtlasCoverage | null;
  /** Times taken by the supplied test sequences. null = no tests supplied. */
  tested: AtlasCoverage | null;
}

export interface AtlasMachine {
  id: string;
  initial: string | null;
  /** Region paths, sorted. Empty for flat machines. */
  regions: string[];
  states: AtlasState[];
  events: AtlasEvent[];
  edges: AtlasEdge[];
  /** null = not fuzzed. */
  fuzz: AtlasFuzz | null;
}

export type AtlasJson =
  | null
  | boolean
  | number
  | string
  | AtlasJson[]
  | { [key: string]: AtlasJson };

/** One input to a machine: an event (`send` for inputs, `inject` for internal) or a clock advance. */
export type AtlasStep =
  | { kind: "event"; event: string; payload: AtlasJson }
  | { kind: "advance"; ms: number };

export interface AtlasFuzzSequence {
  /** Shrunk replayable sequence, starting from a fresh actor. */
  steps: AtlasStep[];
  /** Coverage features this sequence was kept for, e.g. `edge:a>go>b`. */
  discovered: string[];
}

/** A handler that threw: the actor entered its error state. */
export interface AtlasFuzzError {
  from: string;
  event: string;
  message: string;
  steps: AtlasStep[];
}

export interface AtlasFuzz {
  seed: number;
  iterations: number;
  corpus: AtlasFuzzSequence[];
  errors: AtlasFuzzError[];
}

export interface AtlasDocument {
  schemaVersion: typeof ATLAS_SCHEMA_VERSION;
  machines: AtlasMachine[];
}
