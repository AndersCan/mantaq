import type { AnyActor, Snapshot } from "@mantaq/core";

export interface GraphNode {
  id: string;
  label: string;
  isActive: boolean;
  isFinal: boolean;
  depth: number;
  parentId: string | null;
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
  activePath: string[];
}

export interface GraphOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  padding?: number;
}

function collectActiveStates(snapshot: Snapshot, prefix: string, activeSet: Set<string>): void {
  const currentName = snapshot.path[snapshot.path.length - 1];
  if (!currentName) return;

  const fullId = prefix ? `${prefix}.${currentName}` : currentName;
  activeSet.add(fullId);

  for (const [, regionSnap] of Object.entries(snapshot.regions)) {
    collectActiveStates(regionSnap, fullId, activeSet);
  }
}

function buildNodesFromStates(
  states: Array<{ name: string; isFinal: boolean; _regions?: unknown }>,
  snapshot: Snapshot,
  activeSet: Set<string>,
  parentId: string | null,
  depth: number,
  pathPrefix: string,
): GraphNode[] {
  const nodes: GraphNode[] = [];

  for (const stateRef of states) {
    const nodeId = pathPrefix ? `${pathPrefix}.${stateRef.name}` : stateRef.name;
    const isActive = activeSet.has(nodeId);

    nodes.push({
      id: nodeId,
      label: stateRef.name,
      isActive,
      isFinal: stateRef.isFinal,
      depth,
      parentId,
    });
  }

  return nodes;
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
    const sourceId = pathPrefix ? `${pathPrefix}.${stateRef.name}` : stateRef.name;
    const stateTransitions = transitions[stateRef.name];
    if (!stateTransitions) continue;

    for (const [eventId, handler] of Object.entries(stateTransitions)) {
      if (!handler) continue;

      const targetStates = Object.keys(transitions).filter((s) => s !== "Any");

      if (targetStates.length <= 1) {
        edges.push({
          id: `${sourceId}-${eventId}-self`,
          source: sourceId,
          target: sourceId,
          label: eventId,
          isActive: activeSet.has(sourceId),
        });
      } else {
        for (const targetName of targetStates) {
          if (targetName === stateRef.name) continue;
          edges.push({
            id: `${sourceId}-${eventId}-${targetName}`,
            source: sourceId,
            target: targetName,
            label: eventId,
            isActive: activeSet.has(sourceId) || activeSet.has(targetName),
          });
        }
      }
    }
  }

  return edges;
}

function buildForActor(
  actor: AnyActor,
  pathPrefix: string,
  parentId: string | null,
  depth: number,
  activeSet: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const snapshot = actor.snapshot();
  const transitions = actor.options?.transitions as
    | Record<string, Record<string, unknown>>
    | undefined;

  const allStates = (actor.options?.states ?? []) as Array<{
    name: string;
    isFinal: boolean;
    _regions?: unknown;
  }>;

  const nodes = buildNodesFromStates(allStates, snapshot, activeSet, parentId, depth, pathPrefix);
  const edges = buildEdgesFromTransitions(allStates, transitions, activeSet, pathPrefix);

  for (const [regionName, childActor] of Object.entries(actor.regions)) {
    const childPrefix = pathPrefix ? `${pathPrefix}.${regionName}` : regionName;
    const childParentId = pathPrefix || null;
    const childResult = buildForActor(childActor, childPrefix, childParentId, depth + 1, activeSet);
    nodes.push(...childResult.nodes);
    edges.push(...childResult.edges);
  }

  return { nodes, edges };
}

export function buildGraph(actor: AnyActor, _options?: GraphOptions): ActorGraph {
  const snapshot = actor.snapshot();
  const activeSet = new Set<string>();
  collectActiveStates(snapshot, "", activeSet);

  const { nodes, edges } = buildForActor(actor, "", null, 0, activeSet);
  const activePath = [...activeSet];

  return {
    nodes,
    edges,
    activePath,
  };
}
