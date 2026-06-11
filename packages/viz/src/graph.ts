import type { AnyActor, Snapshot } from "@mantaq/core";

export const INITIAL_NODE_ID = "__initial__";

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  isInitial?: boolean;
}

export interface TransitionPayload {
  guard?: string;
  action?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
  isInternal?: boolean;
  effectLabel?: string;
  timerMs?: number;
  payload?: TransitionPayload;
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
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

  if (snapshot.regions) {
    for (const [, regionSnap] of Object.entries(snapshot.regions)) {
      collectActiveStates(regionSnap, fullId, activeSet);
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
  internalIds?: Set<string>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (!transitions) return edges;

  const mockCtx = new Proxy(
    {},
    { get: (_, key) => (key === Symbol.toPrimitive ? undefined : mockCtx) },
  );
  const mockOptions = { context: mockCtx, actor: {} };

  for (const stateRef of states) {
    const sourceId = nodeId(pathPrefix, stateRef.name);
    const stateTransitions = transitions[stateRef.name];
    if (!stateTransitions) continue;

    for (const [eventId, handler] of Object.entries(stateTransitions)) {
      if (typeof handler !== "function") continue;

      const fnStr = handler.toString();
      const guardMatch = fnStr.match(/if\s*\(([^)]{1,80})\)/);
      const guard = guardMatch ? guardMatch[1].trim() : undefined;

      let targetName: string | undefined;
      let emitNames: string[] = [];
      try {
        const result = handler({}, mockOptions);
        targetName = result?.state?.name;
        if (result?.emit) {
          emitNames = result.emit.map((e: { id?: string }) => e.id).filter(Boolean);
        }
      } catch {
        continue;
      }

      if (!targetName) continue;

      const payload: TransitionPayload | undefined =
        guard || emitNames.length > 0
          ? { guard, action: emitNames.length > 0 ? `emit(${emitNames.join(", ")})` : undefined }
          : undefined;

      edges.push({
        id: `${sourceId}-${eventId}-${nodeId(pathPrefix, targetName)}`,
        source: sourceId,
        target: nodeId(pathPrefix, targetName),
        label: eventId,
        isActive: activeSet.has(sourceId),
        isInternal: internalIds?.has(eventId),
        payload,
      });
    }
  }

  return edges;
}

function buildEffectEdges(
  activeSet: Set<string>,
  pendingTimers?: Array<{ id: number; ms: number }>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (!pendingTimers || pendingTimers.length === 0) return edges;

  for (const activeId of activeSet) {
    // Get active state name from id
    const stateName = activeId.split(".").pop() ?? "";
    const displayName = stateName.charAt(0).toUpperCase() + stateName.slice(1);

    for (const timer of pendingTimers) {
      edges.push({
        id: `${activeId}-effect-${timer.id}`,
        source: activeId,
        target: activeId,
        label: `EFFECT_${timer.id}`,
        isActive: true,
        isInternal: true,
        effectLabel: `${displayName} Effect ${timer.id}`,
        timerMs: timer.ms,
      });
    }
  }

  return edges;
}

function buildForActor(
  actor: AnyActor,
  pathPrefix: string,
  activeSet: Set<string>,
  internalIds?: Set<string>,
  pendingTimers?: Array<{ id: number; ms: number }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const states = (actor.options?.states ?? []) as Array<{ name: string; isFinal: boolean }>;
  const nodes = buildNodesFromStates(states, activeSet, pathPrefix);
  const edges = buildEdgesFromTransitions(
    states,
    actor.options?.transitions as Record<string, Record<string, unknown>> | undefined,
    activeSet,
    pathPrefix,
    internalIds,
  );

  // Add effect edges as self-loops on active states
  const effectEdges = buildEffectEdges(activeSet, pendingTimers);
  edges.push(...effectEdges);

  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(
        childActor,
        nodeId(pathPrefix, regionName),
        activeSet,
        internalIds,
        pendingTimers,
      );
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
  }

  return { nodes, edges };
}

export function buildGraph(actor: AnyActor, internalIds?: Set<string>): ActorGraph {
  if (!actor) {
    return { nodes: [], edges: [] };
  }
  try {
    const snapshot = actor.snapshot();
    const activeSet = new Set<string>();
    collectActiveStates(snapshot, "", activeSet);

    // Get pending timers from the actor's clock if available
    let pendingTimers: Array<{ id: number; ms: number }> | undefined;
    const clock = actor.clock as {
      pendingTimers?: () => Array<{ id: number; deadline: number; ms: number }>;
    };
    if (typeof clock.pendingTimers === "function") {
      pendingTimers = clock.pendingTimers().map((t) => ({ id: t.id, ms: t.ms }));
    }

    const { nodes, edges } = buildForActor(actor, "", activeSet, internalIds, pendingTimers);

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

    return {
      nodes,
      edges,
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}
