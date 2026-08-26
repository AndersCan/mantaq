import type { AnyActor, Context } from "@mantaq/core";

/** Synthetic event object for graph introspection — matches minimal InternalEvent shape */
export interface SyntheticEvent {
  type: string;
  payload?: unknown;
}

/** Simplified handler return — matches TransitionResult with erased generics */
interface HandlerResult {
  state?: { name?: string };
  emit?: Array<{ type?: string }>;
}

export type TransitionHandler = (
  event: SyntheticEvent,
  options: { context: Context<Record<string, unknown>>; actor: AnyActor<unknown> },
) => HandlerResult | undefined;

/** Map of state/Any → event → handler */
export type TransitionDispatchMap = Record<string, Record<string, TransitionHandler>>;

/** State definition — matches AnyActor.options.states element type */
export type StateDef = { name: string; isFinal: boolean };

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
  contexts: string[];
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StateVisit {
  stateName: string;
}

export interface TransitionRecord {
  from: string;
  event: string;
  to: string | undefined;
}

export interface EffectRecord {
  stateName: string;
  effectName: string;
}

export type SendRecord = { event: string };

export interface HistoryEntry {
  type: "state_visit" | "transition" | "effect" | "send";
  data: StateVisit | TransitionRecord | EffectRecord | SendRecord;
}
