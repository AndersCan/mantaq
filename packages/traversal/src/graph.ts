import type { AnyActor, Snapshot } from "@mantaq/core";
import type { ActorGraph, GraphNode, GraphEdge } from "./types.ts";

export const INITIAL_NODE_ID = "__initial__";

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

  if (snapshot.regions && !snapshot.done) {
    for (const [regionName, regionSnap] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnap, regionName, activeSet);
    }
  }
}

function nodeId(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function buildNodesFromStates(
  states: Array<{ name: string; isFinal: boolean }>,
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

function buildEdgesFromTransitions(
  states: Array<{ name: string }>,
  transitions: Record<string, Record<string, unknown>> | undefined,
  activeSet: Set<string>,
  pathPrefix: string,
  actor: AnyActor,
  internalIds?: Set<string>,
  namedContexts?: Record<string, Record<string, unknown>>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (!transitions) return edges;

  const contexts = namedContexts ?? { default: { ...actor.context } };
  const contextNames = Object.keys(contexts);

  const anyTransitions = transitions["Any"] as
    | Record<string, ((...args: unknown[]) => unknown) | undefined>
    | undefined;

  function invokeHandler(
    handler: (...args: unknown[]) => unknown,
    eventId: string,
    ctx: Record<string, unknown>,
  ): { targetName?: string; emitNames: string[] } {
    let targetName: string | undefined;
    let emitNames: string[] = [];
    try {
      const syntheticEvent = { id: eventId } as Record<string, unknown>;
      const result = handler(syntheticEvent, { context: ctx, actor }) as
        | { state?: { name?: string }; emit?: Array<{ id?: string }> }
        | undefined;
      targetName = result?.state?.name;
      if (result?.emit) {
        emitNames = result.emit.map((e) => e.id).filter(Boolean) as string[];
      }
    } catch {
      targetName = undefined;
    }
    return { targetName, emitNames };
  }

  function upsertEdge(
    edgeMap: Map<string, GraphEdge>,
    sourceId: string,
    eventId: string,
    targetName: string | undefined,
    emitNames: string[],
    ctxName: string,
  ): void {
    const undetermined = !targetName;
    const targetId = targetName
      ? nodeId(pathPrefix, targetName)
      : `${sourceId}-undetermined-${eventId}`;
    const edgeId = `${sourceId}-${eventId}-${targetId}`;

    const existing = edgeMap.get(edgeId);
    if (existing) {
      existing.contexts!.push(ctxName);
    } else {
      edgeMap.set(edgeId, {
        id: edgeId,
        source: sourceId,
        target: targetId,
        label: eventId,
        isActive: activeSet.has(sourceId),
        isInternal: internalIds?.has(eventId),
        isUndetermined: undetermined,
        contexts: [ctxName],
        ...(emitNames.length > 0 && { payload: { action: `emit(${emitNames.join(", ")})` } }),
      });
    }
  }

  for (const stateRef of states) {
    const sourceId = nodeId(pathPrefix, stateRef.name);
    const stateTransitions = transitions[stateRef.name] as
      | Record<string, ((...args: unknown[]) => unknown) | undefined>
      | undefined;

    const stateTransitionedEvents = new Set<string>();
    const edgeMap = new Map<string, GraphEdge>();

    if (stateTransitions) {
      for (const [eventId, handler] of Object.entries(stateTransitions)) {
        if (typeof handler !== "function") continue;

        for (const ctxName of contextNames) {
          const ctx = contexts[ctxName];
          const { targetName, emitNames } = invokeHandler(handler, eventId, ctx);
          if (targetName) stateTransitionedEvents.add(eventId);
          upsertEdge(edgeMap, sourceId, eventId, targetName, emitNames, ctxName);
        }
      }
    }

    if (anyTransitions) {
      for (const [eventId, handler] of Object.entries(anyTransitions)) {
        if (typeof handler !== "function") continue;
        if (stateTransitionedEvents.has(eventId)) continue;

        for (const ctxName of contextNames) {
          const ctx = contexts[ctxName];
          const { targetName, emitNames } = invokeHandler(handler, eventId, ctx);
          upsertEdge(edgeMap, sourceId, eventId, targetName, emitNames, ctxName);
        }
      }
    }

    edges.push(...edgeMap.values());
  }

  return edges;
}

function buildForActor(
  actor: AnyActor,
  pathPrefix: string,
  activeSet: Set<string>,
  internalIds?: Set<string>,
  namedContexts?: Record<string, Record<string, unknown>>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const states = (actor.options?.states ?? []) as Array<{ name: string; isFinal: boolean }>;
  const nodes = buildNodesFromStates(states, activeSet, pathPrefix);
  const edges = buildEdgesFromTransitions(
    states,
    actor.options?.transitions as Record<string, Record<string, unknown>> | undefined,
    activeSet,
    pathPrefix,
    actor,
    internalIds,
    namedContexts,
  );

  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(
        childActor,
        nodeId(pathPrefix, regionName),
        activeSet,
        internalIds,
        namedContexts,
      );
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
  }

  const effects = (actor.options as Record<string, unknown> | undefined)?.effects as
    | Record<string, unknown[]>
    | undefined;
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

  return { nodes, edges };
}

export function buildGraph(
  actor: AnyActor,
  options?: {
    internalIds?: Set<string>;
    sampleContext?: Record<string, unknown>;
    sampleContexts?: Record<string, Record<string, unknown>>;
  },
): ActorGraph {
  if (!actor) {
    return { nodes: [], edges: [] };
  }
  try {
    const snapshot = actor.snapshot();
    const activeSet = new Set<string>();
    collectActiveStates(snapshot, "", activeSet);

    const namedContexts =
      options?.sampleContexts ??
      (options?.sampleContext ? { default: options.sampleContext } : undefined);

    const { nodes, edges } = buildForActor(
      actor,
      "",
      activeSet,
      options?.internalIds,
      namedContexts,
    );

    const initialName = (actor.options as { initial?: { name?: string } })?.initial?.name;
    if (initialName) {
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

    return { nodes, edges };
  } catch (e) {
    console.error("[mantaq/traversal] buildGraph failed:", e);
    return { nodes: [], edges: [] };
  }
}
