import type { AnyActor } from "@mantaq/core";

/** Synthetic event object for graph introspection — matches minimal InternalEvent shape */
export interface SyntheticEvent {
  id: string;
}

/** Simplified handler return — matches TransitionResult with erased generics */
export interface HandlerResult {
  state?: { name?: string };
  emit?: Array<{ id?: string }>;
}

/** State definition — matches AnyActor.options.states element type */
export type StateDef = { name: string; isFinal: boolean };

/** Transition handler signature for graph introspection */
export type TransitionHandler = (
  event: SyntheticEvent,
  options: { context: Record<string, unknown>; actor: AnyActor },
) => HandlerResult | undefined;

/** Map of state/Any → event → handler */
export type TransitionDispatchMap = Record<string, Record<string, TransitionHandler | undefined>>;

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  isInitial?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  isInternal?: boolean;
  isUndetermined?: boolean;
  payload?: { action?: string };
  contexts?: string[];
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StateVisit {
  stateName: string;
  timestamp: number;
}

export interface TransitionRecord {
  from: string;
  event: string;
  to: string | undefined;
  timestamp: number;
}

export interface EffectRecord {
  stateName: string;
  timestamp: number;
}

export interface HistoryEntry {
  type: "state_visit" | "transition" | "effect" | "send";
  data: StateVisit | TransitionRecord | EffectRecord | { event: string; timestamp: number };
}
