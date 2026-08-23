import type { AnyActor, Snapshot } from "@mantaq/core";
import { buildGraph, instrument } from "@mantaq/traversal";
import type { TestHarness } from "./types.ts";
import { computeCoverage } from "./coverage.ts";
import {
  assertAllStatesVisited,
  assertAllTransitionsVisited,
  assertStateVisited,
  assertStateNeverVisited,
  assertTransitionVisited,
  assertTransitionNeverVisited,
  assertContextNever,
  assertEffectRan,
  assertEffectNeverRan,
} from "./assertions.ts";

export function createTestHarness<C>(actor: AnyActor<C>): TestHarness<C> {
  const instrumented = instrument(actor);
  const internalTypes = new Set(
    ((actor.options as { internal?: Array<{ type: string }> })?.internal ?? []).map((e) => e.type),
  );
  const graph = buildGraph(actor, { internalIds: internalTypes });

  const harness: TestHarness<C> = {
    actor: instrumented,
    graph,
    history: instrumented.history,

    coverage: () => computeCoverage(graph, instrumented.history),

    send(event: { type: string; payload?: unknown }) {
      instrumented.send(event as Parameters<typeof instrumented.send>[0]);
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

    assertAllStatesVisited: () => assertAllStatesVisited(graph, instrumented.history),
    assertAllTransitionsVisited: () => assertAllTransitionsVisited(graph, instrumented.history),
    assertStateVisited: (name: string) => assertStateVisited(instrumented.history, name),
    assertStateNeverVisited: (name: string) => assertStateNeverVisited(instrumented.history, name),
    assertTransitionVisited: (from: string, event: string) =>
      assertTransitionVisited(instrumented.history, from, event),
    assertTransitionNeverVisited: (from: string, event: string) =>
      assertTransitionNeverVisited(instrumented.history, from, event),
    assertContextNever: (predicate: (context: unknown) => boolean) =>
      assertContextNever(instrumented, predicate),
    assertEffectRan: (name: string) => assertEffectRan(instrumented.history, name),
    assertEffectNeverRan: (name: string) => assertEffectNeverRan(instrumented.history, name),

    wasStateVisited: (name: string) => instrumented.history.visitedStates().has(name),
    wasTransitionVisited: (from: string, event: string) =>
      instrumented.history.firedTransitions().has(`${from}:${event}`),
    wasEffectRun: (name: string) =>
      instrumented.history.effects().some((e) => e.stateName === name),

    reset: () => instrumented.history.reset(),
  };

  return harness;
}
