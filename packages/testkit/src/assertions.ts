import type { AnyActor } from "@mantaq/core";
import type { ActorGraph, History } from "@mantaq/traversal";
import { INITIAL_NODE_ID } from "@mantaq/traversal";

/**
 * Assertion-style precondition. A violated assertion is a programmer bug in
 * the test (or the code under test), so it cannot be returned as a value —
 * it explodes the test run, like core's isErrorBomb sites.
 */
function isFailed(check: { holds: boolean; detail: string }): true {
  if (!check.holds) {
    throw new Error(check.detail);
  }
  return true;
}

export function assertAllStatesVisited(graph: ActorGraph, checked: { history: History }): void {
  const visited = checked.history.visitedStates();
  const missing = graph.nodes
    .filter((node) => node.id !== INITIAL_NODE_ID)
    .filter((node) => !visited.has(node.id))
    .map((node) => node.id);
  isFailed({
    holds: missing.length === 0,
    detail: `assertAllStatesVisited failed: states not visited: ${missing.join(", ")}`,
  });
}

export function assertAllTransitionsVisited(
  graph: ActorGraph,
  checked: { history: History },
): void {
  const fired = checked.history.firedTransitions();
  const edges = graph.edges.filter(
    (edge) =>
      edge.source !== INITIAL_NODE_ID &&
      edge.target !== INITIAL_NODE_ID &&
      !edge.isUndetermined &&
      !edge.isInternal,
  );
  const missing = edges.filter((edge) => !fired.has(`${edge.source}:${edge.label}`));
  isFailed({
    holds: missing.length === 0,
    detail: `assertAllTransitionsVisited failed: transitions not visited: ${missing
      .map((edge) => `${edge.source}:${edge.label}`)
      .join(", ")}`,
  });
}

export function assertStateVisited(history: History, target: { stateName: string }): void {
  isFailed({
    holds: history.visitedStates().has(target.stateName),
    detail: `assertStateVisited failed: state "${target.stateName}" was not visited`,
  });
}

export function assertStateNeverVisited(history: History, banned: { stateName: string }): void {
  isFailed({
    holds: !history.visitedStates().has(banned.stateName),
    detail: `assertStateNeverVisited failed: state "${banned.stateName}" was visited`,
  });
}

export function assertTransitionVisited(
  history: History,
  expected: { from: string; event: string },
): void {
  isFailed({
    holds: history.firedTransitions().has(`${expected.from}:${expected.event}`),
    detail: `assertTransitionVisited failed: transition "${expected.from}:${expected.event}" was not visited`,
  });
}

export function assertTransitionNeverVisited(
  history: History,
  banned: { from: string; event: string },
): void {
  isFailed({
    holds: !history.firedTransitions().has(`${banned.from}:${banned.event}`),
    detail: `assertTransitionNeverVisited failed: transition "${banned.from}:${banned.event}" was visited`,
  });
}

export function assertContextNever<C>(
  actor: AnyActor<C>,
  check: { predicate: (context: unknown) => boolean },
): void {
  isFailed({
    holds: !check.predicate(actor.context),
    detail: "assertContextNever failed: predicate matched current context",
  });
}

export function assertEffectRan(
  history: History,
  expected: { stateName: string; effectName: string },
): void {
  const ran = history
    .effects()
    .some(
      (effect) =>
        effect.stateName === expected.stateName && effect.effectName === expected.effectName,
    );
  isFailed({
    holds: ran,
    detail: `assertEffectRan failed: effect "${expected.effectName}" for state "${expected.stateName}" did not run`,
  });
}

export function assertEffectNeverRan(
  history: History,
  banned: { stateName: string; effectName: string },
): void {
  const ran = history
    .effects()
    .some(
      (effect) => effect.stateName === banned.stateName && effect.effectName === banned.effectName,
    );
  isFailed({
    holds: !ran,
    detail: `assertEffectNeverRan failed: effect "${banned.effectName}" for state "${banned.stateName}" ran`,
  });
}
