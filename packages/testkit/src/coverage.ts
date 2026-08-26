import type { CoverageReport } from "./types.ts";
import type { ActorGraph, History } from "@mantaq/traversal";
import { INITIAL_NODE_ID } from "@mantaq/traversal";

export function computeCoverage(graph: ActorGraph, tracked: { history: History }): CoverageReport {
  const visitedStates = tracked.history.visitedStates();
  const firedTransitions = tracked.history.firedTransitions();
  const effects = tracked.history.effects();

  const graphNodes = graph.nodes.filter((node) => node.id !== INITIAL_NODE_ID);
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
  const transitionsVisited = graphEdges.filter((edge) =>
    firedTransitions.has(`${edge.source}:${edge.label}`),
  ).length;
  const transitionsUncovered = graphEdges
    .filter((edge) => !firedTransitions.has(`${edge.source}:${edge.label}`))
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
