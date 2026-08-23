import { INITIAL_NODE_ID, type ActorGraph, type History } from "@mantaq/traversal";
import type { CoverageReport } from "./types.ts";

export function computeCoverage(graph: ActorGraph, history: History): CoverageReport {
  const visitedStates = history.visitedStates();
  const firedTransitions = history.firedTransitions();
  const effects = history.effects();

  const graphNodes = graph.nodes.filter((n) => n.id !== INITIAL_NODE_ID);
  const graphEdges = graph.edges.filter(
    (e) =>
      e.source !== INITIAL_NODE_ID &&
      e.target !== INITIAL_NODE_ID &&
      !e.isUndetermined &&
      !e.isInternal,
  );

  const statesTotal = graphNodes.length;
  const statesVisited = graphNodes.filter((n) => visitedStates.has(n.label)).length;
  const statesUncovered = graphNodes.filter((n) => !visitedStates.has(n.label)).map((n) => n.label);

  const transitionsTotal = graphEdges.length;
  const transitionsVisited = graphEdges.filter((e) =>
    firedTransitions.has(`${e.source}:${e.label}`),
  ).length;
  const transitionsUncovered = graphEdges
    .filter((e) => !firedTransitions.has(`${e.source}:${e.label}`))
    .map((e) => ({ from: e.source, event: e.label }));

  const effectEdges = graph.edges.filter(
    (e) => e.isInternal && e.source === e.target && e.label.startsWith("effect:"),
  );
  const effectStatesFromGraph = new Set(effectEdges.map((e) => e.source));
  const effectsRan = new Set(effects.map((e) => e.stateName));
  const effectsUnexecuted = [...effectStatesFromGraph].filter((s) => !effectsRan.has(s));

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
