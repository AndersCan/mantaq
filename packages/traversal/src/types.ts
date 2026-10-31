import type { AnyActor, Context } from "@mantaq/core";
import type { HandlerResult } from "./is-handler-result.ts";

/** Synthetic event object for graph introspection — matches minimal InternalEvent shape */
export interface SyntheticEvent {
  type: string;
  payload?: unknown;
}

export type TransitionHandler = (
  event: SyntheticEvent,
  options: { context: Context<Record<string, unknown>>; actor: AnyActor<unknown> },
) => HandlerResult | undefined;

/** Map of state/Any → event → handler */
export type TransitionDispatchMap = Record<string, Record<string, TransitionHandler>>;

/** Map of state/Any → event → declared `to` state names (builder `to` option). */
export type TargetMap = Record<string, Record<string, string[]>>;

/** State definition — matches AnyActor.options.states element type */
export type StateDef = { name: string; isFinal: boolean };

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  isInitial?: boolean;
  /** The `*` source of `onAny` edges: any non-final state. */
  isAny?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  isInternal?: boolean;
  isUndetermined?: boolean;
  /** Handled without a state change: the registration declares no `to`. */
  isStay?: boolean;
  /** Target comes from the builder's `to` list, not from running the handler. */
  isDeclared?: boolean;
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
