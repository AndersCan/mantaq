/**
 * Atlas document schema. Bump `ATLAS_SCHEMA_VERSION` on any breaking change.
 * Everything not observable at runtime is `null`, never guessed.
 */
export const ATLAS_SCHEMA_VERSION = 1;

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
  /** Payload types are erased at runtime; always null in v1. */
  payloadType: null;
}

export type AtlasEdgeKind = "initial" | "transition" | "effect";

/** Placeholder for Phase 4 (AST annotation). Always null in v1. */
export type AtlasExplanation = null;

export interface AtlasEdge {
  id: string;
  from: string;
  /** Event id; empty string for the initial edge. */
  event: string;
  /** null = handler target depends on payload or context (undetermined). */
  to: string | null;
  kind: AtlasEdgeKind;
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
}

export interface AtlasDocument {
  schemaVersion: typeof ATLAS_SCHEMA_VERSION;
  machines: AtlasMachine[];
}
