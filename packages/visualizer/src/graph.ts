import type { AnyActor, Snapshot } from "@mantaq/core";

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
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
        payload,
      });
    }
  }

  return edges;
}

function buildForActor(
  actor: AnyActor,
  pathPrefix: string,
  activeSet: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!actor) return { nodes: [], edges: [] };
  const states = (actor.options?.states ?? []) as Array<{ name: string; isFinal: boolean }>;
  const nodes = buildNodesFromStates(states, activeSet, pathPrefix);
  const edges = buildEdgesFromTransitions(
    states,
    actor.options?.transitions as Record<string, Record<string, unknown>> | undefined,
    activeSet,
    pathPrefix,
  );

  if (actor.regions) {
    for (const [regionName, childActor] of Object.entries(actor.regions)) {
      const child = buildForActor(childActor, nodeId(pathPrefix, regionName), activeSet);
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
  }

  return { nodes, edges };
}

export function buildGraph(actor: AnyActor): ActorGraph {
  if (!actor) {
    return { nodes: [], edges: [] };
  }
  try {
    const snapshot = actor.snapshot();
    const activeSet = new Set<string>();
    collectActiveStates(snapshot, "", activeSet);

    const { nodes, edges } = buildForActor(actor, "", activeSet);

    return {
      nodes,
      edges,
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}
