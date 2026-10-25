import { nodeId } from "./graph-ids.ts";
import { isHandlerResult } from "./is-handler-result.ts";
import type {
  GraphEdge,
  SyntheticEvent,
  TransitionDispatchMap,
  TransitionHandler,
} from "./types.ts";
import { Context, type AnyActor } from "@mantaq/core";
import { Either } from "@mantaq/utils";

export interface GraphTraversal {
  actor: AnyActor<unknown>;
  pathPrefix: string;
  activeSet: Set<string>;
  internalIds?: Set<string>;
  contexts: Record<string, Record<string, unknown>>;
  contextNames: string[];
}

interface HandledTransition {
  targetName?: string;
  emitNames: string[];
}

function invokeHandler(
  handler: TransitionHandler,
  options: { eventId: string; context: Record<string, unknown>; actor: AnyActor<unknown> },
): Either<unknown, HandledTransition> {
  return Either.from(() => {
    const syntheticEvent: SyntheticEvent = { type: options.eventId, payload: {} };
    const syntheticContext = Context<Record<string, unknown>>({
      get: () => options.context,
      set: () => {},
    });
    const result: unknown = handler(syntheticEvent, {
      context: syntheticContext,
      actor: options.actor,
    });
    return isHandlerResult(result)
      ? {
          targetName: result.state?.name,
          emitNames:
            result.emit
              ?.map((emitted) => emitted.type)
              .filter((eventType): eventType is string => Boolean(eventType)) ?? [],
        }
      : { targetName: undefined, emitNames: [] };
  });
}

function upsertEdge(sink: {
  edgeMap: Map<string, GraphEdge>;
  sourceId: string;
  ctxName: string;
  traversal: GraphTraversal;
  eventId: string;
  handled: HandledTransition;
}): void {
  const undetermined = !sink.handled.targetName;
  const targetId = sink.handled.targetName
    ? nodeId({ prefix: sink.traversal.pathPrefix, name: sink.handled.targetName })
    : `${sink.sourceId}-undetermined-${sink.eventId}`;
  const edgeId = `${sink.sourceId}-${sink.eventId}-${targetId}`;

  const existing = sink.edgeMap.get(edgeId);
  if (existing) {
    existing.contexts.push(sink.ctxName);
  } else {
    sink.edgeMap.set(edgeId, {
      id: edgeId,
      source: sink.sourceId,
      target: targetId,
      label: sink.eventId,
      isActive: sink.traversal.activeSet.has(sink.sourceId),
      isInternal: sink.traversal.internalIds?.has(sink.eventId),
      isUndetermined: undetermined,
      contexts: [sink.ctxName],
      ...(sink.handled.emitNames.length > 0 && {
        payload: { action: `emit(${sink.handled.emitNames.join(", ")})` },
      }),
    });
  }
}

interface TransitionPass {
  edgeMap: Map<string, GraphEdge>;
  sourceId: string;
  traversal: GraphTraversal;
}

function processStateTransitions(options: {
  stateTransitions: Record<string, TransitionHandler>;
  pass: TransitionPass;
}): Set<string> {
  const stateTransitionedEvents = new Set<string>();
  for (const [eventId, handler] of Object.entries(options.stateTransitions)) {
    for (const ctxName of options.pass.traversal.contextNames) {
      const sampleContext = options.pass.traversal.contexts[ctxName];
      if (sampleContext === undefined) continue;
      const handled = Either.getOrElse(
        invokeHandler(handler, {
          eventId,
          context: sampleContext,
          actor: options.pass.traversal.actor,
        }),
        { onLeft: () => ({ targetName: undefined, emitNames: [] }) },
      );
      if (handled.targetName) stateTransitionedEvents.add(eventId);
      upsertEdge({
        edgeMap: options.pass.edgeMap,
        sourceId: options.pass.sourceId,
        ctxName,
        traversal: options.pass.traversal,
        eventId,
        handled,
      });
    }
  }
  return stateTransitionedEvents;
}

function mergeAnyTransitions(options: {
  anyTransitions: Record<string, TransitionHandler>;
  stateTransitionedEvents: Set<string>;
  pass: TransitionPass;
}): void {
  for (const [eventId, handler] of Object.entries(options.anyTransitions)) {
    if (options.stateTransitionedEvents.has(eventId)) continue;
    for (const ctxName of options.pass.traversal.contextNames) {
      const sampleContext = options.pass.traversal.contexts[ctxName];
      if (sampleContext === undefined) continue;
      const handled = Either.getOrElse(
        invokeHandler(handler, {
          eventId,
          context: sampleContext,
          actor: options.pass.traversal.actor,
        }),
        { onLeft: () => ({ targetName: undefined, emitNames: [] }) },
      );
      upsertEdge({
        edgeMap: options.pass.edgeMap,
        sourceId: options.pass.sourceId,
        ctxName,
        traversal: options.pass.traversal,
        eventId,
        handled,
      });
    }
  }
}

function collectTransitionsForState(edges: {
  stateTransitions: Record<string, TransitionHandler> | undefined;
  anyTransitions: Record<string, TransitionHandler> | undefined;
  sourceId: string;
  traversal: GraphTraversal;
}): Map<string, GraphEdge> {
  const edgeMap = new Map<string, GraphEdge>();
  const pass: TransitionPass = {
    edgeMap,
    sourceId: edges.sourceId,
    traversal: edges.traversal,
  };
  const stateTransitionedEvents = edges.stateTransitions
    ? processStateTransitions({ stateTransitions: edges.stateTransitions, pass })
    : new Set<string>();

  if (edges.anyTransitions) {
    mergeAnyTransitions({
      anyTransitions: edges.anyTransitions,
      stateTransitionedEvents,
      pass,
    });
  }

  return edgeMap;
}

export function buildEdgesFromTransitions(edges: {
  states: ReadonlyArray<{ name: string }>;
  transitions: TransitionDispatchMap;
  traversal: GraphTraversal;
}): GraphEdge[] {
  const allEdges: GraphEdge[] = [];
  const anyTransitions = edges.transitions["Any"];

  for (const stateEntry of edges.states) {
    const sourceId = nodeId({ prefix: edges.traversal.pathPrefix, name: stateEntry.name });
    const edgeMap = collectTransitionsForState({
      stateTransitions: edges.transitions[stateEntry.name],
      anyTransitions,
      sourceId,
      traversal: edges.traversal,
    });
    allEdges.push(...edgeMap.values());
  }

  return allEdges;
}
