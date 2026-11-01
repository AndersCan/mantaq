import type { CoverageReport } from "./types.ts";
import type { ActorGraph, History } from "@mantaq/traversal";
import { INITIAL_NODE_ID, isAnyNode } from "@mantaq/traversal";

export function computeCoverage(graph: ActorGraph, tracked: { history: History }): CoverageReport {
  const visitedStates = tracked.history.visitedStates();
  const firedTransitions = tracked.history.firedTransitions();
  const effects = tracked.history.effects();

  const firedRecords = tracked.history.transitions();
  const isFired = (edge: { source: string; label: string }) =>
    isAnyNode(edge.source)
      ? firedRecords.some(
          (record) => record.event === edge.label && isInAnyScope(record.from, edge.source),
        )
      : firedTransitions.has(`${edge.source}:${edge.label}`);

  const graphNodes = graph.nodes.filter(
    (node) => node.id !== INITIAL_NODE_ID && !isAnyNode(node.id),
  );
  const graphEdges = graph.edges.filter(
    (edge) =>
      edge.source !== INITIAL_NODE_ID &&
      edge.target !== INITIAL_NODE_ID &&
      !edge.isUndetermined &&
      !edge.isInternal,
  );

  const statesTotal = graphNodes.length;
  const statesVisited = graphNodes.filter((node) => visitedStates.has(node.id)).length;
  const statesUncovered = graphNodes
    .filter((node) => !visitedStates.has(node.id))
    .map((node) => node.id);

  const transitionsTotal = graphEdges.length;
  const transitionsVisited = graphEdges.filter(isFired).length;
  const transitionsUncovered = graphEdges
    .filter((edge) => !isFired(edge))
    .map((edge) => ({ from: edge.source, event: edge.label }));

  const effectEdges = graph.edges.filter(
    (edge) => edge.isInternal && edge.source === edge.target && edge.label.startsWith("effect:"),
  );
  const effectStatesFromGraph = new Set(effectEdges.map((edge) => edge.source));
  const effectsRan = new Set(effects.map((effect) => effect.stateName));
  const effectsUnexecuted = [...effectStatesFromGraph].filter(
    (stateName) => !effectsRan.has(stateName),
  );

  return {
    states: { total: statesTotal, visited: statesVisited, uncovered: statesUncovered },
    transitions: {
      total: transitionsTotal,
      visited: transitionsVisited,
      uncovered: transitionsUncovered,
    },
    effects: {
      total: effectStatesFromGraph.size,
      ran: effectsRan.size,
      unexecuted: effectsUnexecuted,
    },
    percent: {
      states: statesTotal === 0 ? 0 : (statesVisited / statesTotal) * 100,
      transitions: transitionsTotal === 0 ? 0 : (transitionsVisited / transitionsTotal) * 100,
      effects:
        effectStatesFromGraph.size === 0 ? 0 : (effectsRan.size / effectStatesFromGraph.size) * 100,
    },
  };
}

function isInAnyScope(from: string, anyNodeId: string): boolean {
  const prefix = anyNodeId.slice(0, -1);
  return from.startsWith(prefix) && !from.slice(prefix.length).includes(".");
}
