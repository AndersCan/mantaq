/**
 * Atlas document schema. Bump `ATLAS_SCHEMA_VERSION` on any breaking change.
 * Everything not observable at runtime is `null`, never guessed.
 */
export const ATLAS_SCHEMA_VERSION = 2;

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
  /** null = no run supplied; otherwise visit count. */
  coverage: AtlasCoverage | null;
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

/** Placeholder for Phase 4 (AST annotation). Always null in v2. */
export type AtlasExplanation = null;

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
  explanation: AtlasExplanation;
  /** null = no run supplied; otherwise transition count. */
  coverage: AtlasCoverage | null;
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
