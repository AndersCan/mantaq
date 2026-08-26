import {
  assertAllStatesVisited,
  assertAllTransitionsVisited,
  assertContextNever,
  assertEffectNeverRan,
  assertEffectRan,
  assertStateNeverVisited,
  assertStateVisited,
  assertTransitionNeverVisited,
  assertTransitionVisited,
} from "./assertions.ts";
import { computeCoverage } from "./coverage.ts";
import type { TestHarness } from "./types.ts";
import type { AnyActor, Snapshot } from "@mantaq/core";
import { buildGraph, instrument, parseInternalEventIds } from "@mantaq/traversal";

export function createTestHarness<C>(actor: AnyActor<C>): TestHarness<C> {
  const instrumented = instrument(actor);
  const internalTypes = parseInternalEventIds(actor.options);
  const graph = buildGraph(actor, { internalIds: internalTypes });

  const harness: TestHarness<C> = {
    actor: instrumented,
    graph,
    history: instrumented.history,

    coverage: () => computeCoverage(graph, { history: instrumented.history }),

    send(event) {
      instrumented.send(event);
    },

    get state() {
      return instrumented.state;
    },

    snapshot(): Snapshot<C> {
      return instrumented.snapshot();
    },

    get context() {
      return instrumented.context;
    },

    assertAllStatesVisited: () => assertAllStatesVisited(graph, { history: instrumented.history }),
    assertAllTransitionsVisited: () =>
      assertAllTransitionsVisited(graph, { history: instrumented.history }),
    assertStateVisited: (target) => assertStateVisited(instrumented.history, target),
    assertStateNeverVisited: (banned) => assertStateNeverVisited(instrumented.history, banned),
    assertTransitionVisited: (expected) => assertTransitionVisited(instrumented.history, expected),
    assertTransitionNeverVisited: (banned) =>
      assertTransitionNeverVisited(instrumented.history, banned),
    assertContextNever: (check) => assertContextNever(instrumented, check),
    assertEffectRan: (expected) => assertEffectRan(instrumented.history, expected),
    assertEffectNeverRan: (banned) => assertEffectNeverRan(instrumented.history, banned),

    wasStateVisited: (stateName) => instrumented.history.visitedStates().has(stateName),
    wasTransitionVisited: (expected) =>
      instrumented.history.firedTransitions().has(`${expected.from}:${expected.event}`),
    wasEffectRun: (queried) =>
      instrumented.history
        .effects()
        .some(
          (effect) =>
            effect.stateName === queried.stateName && effect.effectName === queried.effectName,
        ),

    reset: () => instrumented.history.reset(),
  };

  return harness;
}
