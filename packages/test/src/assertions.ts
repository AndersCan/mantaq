import type { History, ActorGraph } from "@mantaq/traversal";
import { INITIAL_NODE_ID } from "@mantaq/traversal";
import type { AnyActor } from "@mantaq/core";

export function assertAllStatesVisited(graph: ActorGraph, history: History): void {
  const visited = history.visitedStates();
  const missing = graph.nodes
    .filter((n) => n.id !== INITIAL_NODE_ID)
    .filter((n) => !visited.has(n.id))
    .map((n) => n.id);
  if (missing.length > 0) {
    throw new Error(`assertAllStatesVisited failed: states not visited: ${missing.join(", ")}`);
  }
}

export function assertAllTransitionsVisited(graph: ActorGraph, history: History): void {
  const fired = history.firedTransitions();
  const edges = graph.edges.filter(
    (e) =>
      e.source !== INITIAL_NODE_ID &&
      e.target !== INITIAL_NODE_ID &&
      !e.isUndetermined &&
      !e.isInternal,
  );
  const missing = edges.filter((e) => !fired.has(`${e.source}:${e.label}`));
  if (missing.length > 0) {
    const list = missing.map((e) => `${e.source}:${e.label}`).join(", ");
    throw new Error(`assertAllTransitionsVisited failed: transitions not visited: ${list}`);
  }
}

export function assertStateVisited(history: History, stateName: string): void {
  if (!history.visitedStates().has(stateName)) {
    throw new Error(`assertStateVisited failed: state "${stateName}" was not visited`);
  }
}

export function assertStateNeverVisited(history: History, stateName: string): void {
  if (history.visitedStates().has(stateName)) {
    throw new Error(`assertStateNeverVisited failed: state "${stateName}" was visited`);
  }
}

export function assertTransitionVisited(history: History, from: string, event: string): void {
  if (!history.firedTransitions().has(`${from}:${event}`)) {
    throw new Error(
      `assertTransitionVisited failed: transition "${from}:${event}" was not visited`,
    );
  }
}

export function assertTransitionNeverVisited(history: History, from: string, event: string): void {
  if (history.firedTransitions().has(`${from}:${event}`)) {
    throw new Error(
      `assertTransitionNeverVisited failed: transition "${from}:${event}" was visited`,
    );
  }
}

export function assertContextNever<C>(
  actor: AnyActor<C>,
  predicate: (context: unknown) => boolean,
): void {
  if (predicate(actor.context)) {
    throw new Error("assertContextNever failed: predicate matched current context");
  }
}

export function assertEffectRan(history: History, stateName: string): void {
  const ran = history.effects().some((e) => e.stateName === stateName);
  if (!ran) {
    throw new Error(`assertEffectRan failed: effect for state "${stateName}" did not run`);
  }
}

export function assertEffectNeverRan(history: History, stateName: string): void {
  const ran = history.effects().some((e) => e.stateName === stateName);
  if (ran) {
    throw new Error(`assertEffectNeverRan failed: effect for state "${stateName}" ran`);
  }
}
