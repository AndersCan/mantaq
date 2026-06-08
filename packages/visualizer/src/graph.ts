import type { AnyActor, Snapshot } from "@mantaq/core";

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  isActive: boolean;
}

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function collectActiveStates(snapshot: Snapshot, prefix: string, activeSet: Set<string>): void {
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = nodeId(prefix, currentName);
  activeSet.add(fullId);

  for (const [, regionSnap] of Object.entries(snapshot.regions)) {
    collectActiveStates(regionSnap, fullId, activeSet);
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

  for (const stateRef of states) {
    const sourceId = nodeId(pathPrefix, stateRef.name);
    const stateTransitions = transitions[stateRef.name];
    if (!stateTransitions) continue;

    for (const [eventId, handler] of Object.entries(stateTransitions)) {
      if (!handler) continue;

      let targetName: string | undefined;
      try {
        targetName = (handler as Function)?.({}, { context: {} })?.state?.name;
      } catch {
        continue;
      }

      if (!targetName) continue;

      edges.push({
        id: `${sourceId}-${eventId}-${nodeId(pathPrefix, targetName)}`,
        source: sourceId,
        target: nodeId(pathPrefix, targetName),
        label: eventId,
        isActive: activeSet.has(sourceId),
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
  const states = (actor.options?.states ?? []) as Array<{ name: string; isFinal: boolean }>;
  const nodes = buildNodesFromStates(states, activeSet, pathPrefix);
  const edges = buildEdgesFromTransitions(
    states,
    actor.options?.transitions as Record<string, Record<string, unknown>> | undefined,
    activeSet,
    pathPrefix,
  );

  for (const [regionName, childActor] of Object.entries(actor.regions)) {
    const child = buildForActor(childActor, nodeId(pathPrefix, regionName), activeSet);
    nodes.push(...child.nodes);
    edges.push(...child.edges);
  }

  return { nodes, edges };
}

export function buildGraph(actor: AnyActor): ActorGraph {
  const snapshot = actor.snapshot();
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, "", activeSet);

  const { nodes, edges } = buildForActor(actor, "", activeSet);

  return {
    nodes,
    edges,
  };
}
