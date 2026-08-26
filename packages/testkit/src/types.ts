import type { AnyActor, Snapshot } from "@mantaq/core";
import type { ActorGraph, History } from "@mantaq/traversal";

export interface CoverageReport {
  states: { total: number; visited: number; uncovered: string[] };
  transitions: {
    total: number;
    visited: number;
    uncovered: Array<{ from: string; event: string }>;
  };
  effects: { total: number; ran: number; unexecuted: string[] };
  percent: { states: number; transitions: number; effects: number };
}

export interface TestHarness<C = Record<string, unknown>> {
  actor: AnyActor<C>;
  graph: ActorGraph;
  history: History;
  coverage: () => CoverageReport;

  send(event: { type: string; payload?: unknown }): void;
  state: AnyActor["state"];
  snapshot(): Snapshot<C>;
  context: C | undefined;

  assertAllStatesVisited(): void;
  assertAllTransitionsVisited(): void;
  assertStateVisited(target: { stateName: string }): void;
  assertStateNeverVisited(banned: { stateName: string }): void;
  assertTransitionVisited(expected: { from: string; event: string }): void;
  assertTransitionNeverVisited(banned: { from: string; event: string }): void;
  assertContextNever(check: { predicate: (context: unknown) => boolean }): void;
  assertEffectRan(expected: { stateName: string; effectName: string }): void;
  assertEffectNeverRan(banned: { stateName: string; effectName: string }): void;

  wasStateVisited(stateName: string): boolean;
  wasTransitionVisited(expected: { from: string; event: string }): boolean;
  wasEffectRun(queried: { stateName: string; effectName: string }): boolean;

  reset(): void;
}
