import type { AnyActor, Snapshot } from "@mantaq/core";
import { Context } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import type {
  ActorGraph,
  GraphNode,
  GraphEdge,
  SyntheticEvent,
  StateDef,
  TransitionHandler,
  TransitionDispatchMap,
} from "./types.ts";

export const INITIAL_NODE_ID = "__initial__";

interface GraphTraversal {
  actor: AnyActor<unknown>;
  pathPrefix: string;
  activeSet: Set<string>;
  internalIds?: Set<string>;
  contexts: Record<string, Record<string, unknown>>;
  contextNames: string[];
}

interface TransitionPass {
  edgeMap: Map<string, GraphEdge>;
  sourceId: string;
  traversal: GraphTraversal;
}

interface HandledTransition {
  targetName?: string;
  emitNames: string[];
}

export function collectActiveStates(
  snapshot: Snapshot,
  prefix: string,
  activeSet: Set<string>,
): void {
  if (!snapshot || !snapshot.path) return;
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = nodeId(prefix, currentName);
  activeSet.add(fullId);

  if (snapshot.regions && !snapshot.done && !snapshot.error) {
    for (const [regionName, regionSnap] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnap, regionName, activeSet);
    }
  }
}

function nodeId(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function buildNodesFromStates(
  states: ReadonlyArray<StateDef>,
  activeSet: Set<string>,
  pathPrefix: string,
): GraphNode[] {
  return states.map((stateRef) => {
    const nid = nodeId(pathPrefix, stateRef.name);
    return {
      id: nid,
      label: stateRef.name,
      isActive: activeSet.has(nid),
      isFinal: stateRef.isFinal,
    };
  });
}

function invokeHandler(
  handler: TransitionHandler,
  eventId: string,
  context: Record<string, unknown>,
  actor: AnyActor<unknown>,
): Either<unknown, HandledTransition> {
  return Either.from(() => {
    const syntheticEvent: SyntheticEvent = { type: eventId, payload: {} };
    const syntheticContext = new Context<Record<string, unknown>>(
      () => context,
      () => {},
    );
    const result = handler(syntheticEvent, { context: syntheticContext, actor });
    return {
      targetName: result?.state?.name,
      emitNames:
        result?.emit?.map((e) => e.type).filter((type): type is string => Boolean(type)) ?? [],
    };
  });
}

function upsertEdge(
  sink: { edgeMap: Map<string, GraphEdge>; sourceId: string; ctxName: string },
  traversal: GraphTraversal,
  eventId: string,
  handled: HandledTransition,
): void {
  const undetermined = !handled.targetName;
  const targetId = handled.targetName
    ? nodeId(traversal.pathPrefix, handled.targetName)
    : `${sink.sourceId}-undetermined-${eventId}`;
  const edgeId = `${sink.sourceId}-${eventId}-${targetId}`;

  const existing = sink.edgeMap.get(edgeId);
  if (existing) {
    existing.contexts!.push(sink.ctxName);
  } else {
    sink.edgeMap.set(edgeId, {
      id: edgeId,
      source: sink.sourceId,
      target: targetId,
      label: eventId,
      isActive: traversal.activeSet.has(sink.sourceId),
      isInternal: traversal.internalIds?.has(eventId),
      isUndetermined: undetermined,
      contexts: [sink.ctxName],
      ...(handled.emitNames.length > 0 && {
        payload: { action: `emit(${handled.emitNames.join(", ")})` },
      }),
    });
  }
}

function processStateTransitions(
  stateTransitions: Record<string, TransitionHandler | undefined>,
  pass: TransitionPass,
): Set<string> {
  const stateTransitionedEvents = new Set<string>();
  for (const [eventId, handler] of Object.entries(stateTransitions)) {
    if (typeof handler !== "function") continue;
    for (const ctxName of pass.traversal.contextNames) {
      const sampleContext = pass.traversal.contexts[ctxName];
      const handled = Either.getOrElse(
        invokeHandler(handler, eventId, sampleContext, pass.traversal.actor),
        () => ({ targetName: undefined, emitNames: [] }),
      );
      if (handled.targetName) stateTransitionedEvents.add(eventId);
      upsertEdge(
        { edgeMap: pass.edgeMap, sourceId: pass.sourceId, ctxName },
        pass.traversal,
        eventId,
        handled,
      );
    }
  }
  return stateTransitionedEvents;
}

function mergeAnyTransitions(
  anyTransitions: Record<string, TransitionHandler | undefined>,
  stateTransitionedEvents: Set<string>,
  pass: TransitionPass,
): void {
  for (const [eventId, handler] of Object.entries(anyTransitions)) {
    if (typeof handler !== "function") continue;
    if (stateTransitionedEvents.has(eventId)) continue;
    for (const ctxName of pass.traversal.contextNames) {
      const sampleContext = pass.traversal.contexts[ctxName];
      const handled = Either.getOrElse(
        invokeHandler(handler, eventId, sampleContext, pass.traversal.actor),
        () => ({ targetName: undefined, emitNames: [] }),
      );
      upsertEdge(
        { edgeMap: pass.edgeMap, sourceId: pass.sourceId, ctxName },
        pass.traversal,
        eventId,
        handled,
      );
    }
  }
}

function collectTransitionsForState(
  stateTransitions: Record<string, TransitionHandler | undefined> | undefined,
  anyTransitions: Record<string, TransitionHandler | undefined> | undefined,
  sourceId: string,
  traversal: GraphTraversal,
): Map<string, GraphEdge> {
  const edgeMap = new Map<string, GraphEdge>();
  const pass: TransitionPass = { edgeMap, sourceId, traversal };
  const stateTransitionedEvents = stateTransitions
    ? processStateTransitions(stateTransitions, pass)
    : new Set<string>();

  if (anyTransitions) {
    mergeAnyTransitions(anyTransitions, stateTransitionedEvents, pass);
  }

  return edgeMap;
}

function buildEdgesFromTransitions(
  states: ReadonlyArray<{ name: string }>,
  transitions: TransitionDispatchMap | undefined,
  traversal: GraphTraversal,
): GraphEdge[] {
  if (!transitions) return [];

  const anyTransitions = transitions["Any"];
  const edges: GraphEdge[] = [];

  for (const stateRef of states) {
    const sourceId = nodeId(traversal.pathPrefix, stateRef.name);
    const edgeMap = collectTransitionsForState(
      transitions[stateRef.name],
      anyTransitions,
      sourceId,
      traversal,
    );
    edges.push(...edgeMap.values());
  }

  return edges;
}

function addNodesForActor(
  actor: AnyActor<unknown>,
  pathPrefix: string,
  activeSet: Set<string>,
): GraphNode[] {
  const states = (actor.options?.states ?? []) as ReadonlyArray<StateDef>;
  return buildNodesFromStates(states, activeSet, pathPrefix);
}

function addEdgesForActor(actor: AnyActor<unknown>, traversal: GraphTraversal): GraphEdge[] {
  const states = (actor.options?.states ?? []) as ReadonlyArray<StateDef>;
  return buildEdgesFromTransitions(
    states,
    // AnyActor.options.types transitions values as unknown — actual type is handler functions (TransitionDispatch in actor.ts)
    actor.options?.transitions as TransitionDispatchMap | undefined,
    traversal,
  );
}

function recurseRegions(
  actor: AnyActor<unknown>,
  traversal: GraphTraversal,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(childActor, {
        ...traversal,
        pathPrefix: nodeId(traversal.pathPrefix, regionName),
      });
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
  }
  return { nodes, edges };
}

function addEffectSelfLoops(
  actor: AnyActor<unknown>,
  pathPrefix: string,
  activeSet: Set<string>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const effects = actor.options?.effects;
  if (effects) {
    for (const [stateName, fns] of Object.entries(effects)) {
      if (Array.isArray(fns) && fns.length > 0) {
        const sid = nodeId(pathPrefix, stateName);
        edges.push({
          id: `${sid}-effect:${stateName}-${sid}`,
          source: sid,
          target: sid,
          label: `effect:${stateName}`,
          isActive: activeSet.has(sid),
          isInternal: true,
        });
      }
    }
  }
  return edges;
}

function buildForActor(
  actor: AnyActor<unknown>,
  traversal: GraphTraversal,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const nodes = addNodesForActor(actor, traversal.pathPrefix, traversal.activeSet);
  const edges = addEdgesForActor(actor, traversal);
  const region = recurseRegions(actor, traversal);
  nodes.push(...region.nodes);
  edges.push(...region.edges);
  edges.push(...addEffectSelfLoops(actor, traversal.pathPrefix, traversal.activeSet));
  return { nodes, edges };
}

function addInitialNode(actor: AnyActor<unknown>, nodes: GraphNode[], edges: GraphEdge[]): void {
  // AnyActor.options type lacks `initial` field — cast required (see actor-internal.ts)
  const initialName = (actor.options as { initial?: { name?: string } })?.initial?.name;
  if (!initialName) return;
  const initNodeId = nodeId("", INITIAL_NODE_ID);
  const targetId = nodeId("", initialName);
  nodes.push({
    id: initNodeId,
    label: "",
    isActive: false,
    isFinal: false,
    isInitial: true,
  });
  edges.push({
    id: `${initNodeId}->${targetId}`,
    source: initNodeId,
    target: targetId,
    label: "",
    isActive: true,
  });
}

function collectActorsFromSnapshot(snapshot: Snapshot): Set<string> {
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, "", activeSet);
  return activeSet;
}

function collectNamedContexts(options?: {
  sampleContext?: Record<string, unknown>;
  sampleContexts?: Record<string, Record<string, unknown>>;
}): Record<string, Record<string, unknown>> | undefined {
  return (
    options?.sampleContexts ??
    (options?.sampleContext ? { default: options.sampleContext } : undefined)
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
        default: { ...actor.context } as Record<string, unknown>,
      };
      const traversal: GraphTraversal = {
        actor,
        pathPrefix: "",
        activeSet,
        internalIds: options?.internalIds,
        contexts,
        contextNames: Object.keys(contexts),
      };

      const { nodes, edges } = buildForActor(actor, traversal);

      addInitialNode(actor, nodes, edges);
      return { nodes, edges };
    }),
    () => ({ nodes: [], edges: [] }),
  );
}
