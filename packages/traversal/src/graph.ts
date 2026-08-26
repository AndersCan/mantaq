import { isHandlerResult } from "./is-handler-result.ts";
import {
  parseContextRecord,
  parseInitialName,
  parseStates,
  parseTransitionMap,
} from "./parse-graph.ts";
import type {
  ActorGraph,
  GraphEdge,
  GraphNode,
  StateDef,
  SyntheticEvent,
  TransitionDispatchMap,
  TransitionHandler,
} from "./types.ts";
import { Context, type AnyActor, type Snapshot } from "@mantaq/core";
import { Either } from "@mantaq/utils";

export const INITIAL_NODE_ID = "__initial__";

interface GraphTraversal {
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

export function collectActiveStates(
  snapshot: Snapshot,
  options: { prefix: string; activeSet: Set<string> },
): void {
  if (!snapshot.path) return;
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = nodeId({ prefix: options.prefix, name: currentName });
  options.activeSet.add(fullId);

  if (snapshot.regions && !snapshot.done && !snapshot.error) {
    for (const [regionName, regionSnapshot] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnapshot, { prefix: regionName, activeSet: options.activeSet });
    }
  }
}

function nodeId(identity: { prefix: string; name: string }): string {
  return identity.prefix ? `${identity.prefix}.${identity.name}` : identity.name;
}

function buildNodesFromStates(
  states: ReadonlyArray<StateDef>,
  options: { activeSet: Set<string>; pathPrefix: string },
): GraphNode[] {
  return states.map((stateEntry) => {
    const graphId = nodeId({ prefix: options.pathPrefix, name: stateEntry.name });
    return {
      id: graphId,
      label: stateEntry.name,
      isActive: options.activeSet.has(graphId),
      isFinal: stateEntry.isFinal,
    };
  });
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

function buildEdgesFromTransitions(edges: {
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

function addNodesForActor(
  actor: AnyActor<unknown>,
  layout: { pathPrefix: string; activeSet: Set<string> },
): GraphNode[] {
  const states = parseStates(actor.options);
  return buildNodesFromStates(states, {
    activeSet: layout.activeSet,
    pathPrefix: layout.pathPrefix,
  });
}

function addEdgesForActor(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): GraphEdge[] {
  const states = parseStates(actor.options);
  const transitions = parseTransitionMap(actor.options?.transitions);
  return buildEdgesFromTransitions({ states, transitions, traversal: layout.traversal });
}

function recurseRegions(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const childEdges: GraphEdge[] = [];
  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(childActor, {
        traversal: {
          ...layout.traversal,
          pathPrefix: nodeId({ prefix: layout.traversal.pathPrefix, name: regionName }),
        },
      });
      nodes.push(...child.nodes);
      childEdges.push(...child.edges);
    }
  }
  return { nodes, edges: childEdges };
}

function addEffectSelfLoops(
  actor: AnyActor<unknown>,
  layout: { pathPrefix: string; activeSet: Set<string> },
): GraphEdge[] {
  const selfLoops: GraphEdge[] = [];
  const effects = actor.options?.effects;
  if (effects) {
    for (const [stateName, effectFns] of Object.entries(effects)) {
      if (Array.isArray(effectFns) && effectFns.length > 0) {
        const loopId = nodeId({ prefix: layout.pathPrefix, name: stateName });
        selfLoops.push({
          id: `${loopId}-effect:${stateName}-${loopId}`,
          source: loopId,
          target: loopId,
          label: `effect:${stateName}`,
          isActive: layout.activeSet.has(loopId),
          isInternal: true,
          contexts: [],
        });
      }
    }
  }
  return selfLoops;
}

function buildForActor(
  actor: AnyActor<unknown>,
  layout: { traversal: GraphTraversal },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const nodes = addNodesForActor(actor, {
    pathPrefix: layout.traversal.pathPrefix,
    activeSet: layout.traversal.activeSet,
  });
  const actorEdges = addEdgesForActor(actor, { traversal: layout.traversal });
  const region = recurseRegions(actor, { traversal: layout.traversal });
  nodes.push(...region.nodes);
  actorEdges.push(...region.edges);
  actorEdges.push(
    ...addEffectSelfLoops(actor, {
      pathPrefix: layout.traversal.pathPrefix,
      activeSet: layout.traversal.activeSet,
    }),
  );
  return { nodes, edges: actorEdges };
}

function addInitialNode(
  actor: AnyActor<unknown>,
  layout: { nodes: GraphNode[]; graphEdges: GraphEdge[] },
): void {
  const initialName = parseInitialName(actor.options);
  if (!initialName) return;
  const initNodeId = INITIAL_NODE_ID;
  const targetId = nodeId({ prefix: "", name: initialName });
  layout.nodes.push({
    id: initNodeId,
    label: "",
    isActive: false,
    isFinal: false,
    isInitial: true,
  });
  layout.graphEdges.push({
    id: `${initNodeId}->${targetId}`,
    source: initNodeId,
    target: targetId,
    label: "",
    isActive: true,
    contexts: [],
  });
}

function collectActorsFromSnapshot(snapshot: Snapshot): Set<string> {
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, { prefix: "", activeSet });
  return activeSet;
}

function collectNamedContexts(named?: {
  sampleContext?: Record<string, unknown>;
  sampleContexts?: Record<string, Record<string, unknown>>;
}): Record<string, Record<string, unknown>> | undefined {
  return (
    named?.sampleContexts ?? (named?.sampleContext ? { default: named.sampleContext } : undefined)
  );
}

export function buildGraph<C>(
  actor: AnyActor<C>,
  options?: {
    internalIds?: Set<string>;
    sampleContext?: Record<string, unknown>;
    sampleContexts?: Record<string, Record<string, unknown>>;
  },
): ActorGraph {
  if (!actor) return { nodes: [], edges: [] };
  return Either.getOrElse(
    Either.from(() => {
      const activeSet = collectActorsFromSnapshot(actor.snapshot());
      const namedContexts = collectNamedContexts(options);
      const contexts = namedContexts ?? {
        default: parseContextRecord(actor.context),
      };
      const traversal: GraphTraversal = {
        actor,
        pathPrefix: "",
        activeSet,
        internalIds: options?.internalIds,
        contexts,
        contextNames: Object.keys(contexts),
      };

      const built = buildForActor(actor, { traversal });

      addInitialNode(actor, { nodes: built.nodes, graphEdges: built.edges });
      return { nodes: built.nodes, edges: built.edges };
    }),
    { onLeft: () => ({ nodes: [], edges: [] }) },
  );
}
