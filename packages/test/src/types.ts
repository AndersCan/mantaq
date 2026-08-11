import type { ActorGraph, History } from "@mantaq/traversal";
import type { AnyActor, Snapshot } from "@mantaq/core";

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

export interface TestHarness {
  actor: AnyActor;
  graph: ActorGraph;
  history: History;
  coverage: () => CoverageReport;

  send(event: { type: string; payload?: unknown }): void;
  state: AnyActor["state"];
  snapshot(): Snapshot;
  context: Record<string, unknown> | undefined;

  assertAllStatesVisited(): void;
  assertAllTransitionsVisited(): void;
  assertStateVisited(stateName: string): void;
  assertStateNeverVisited(stateName: string): void;
  assertTransitionVisited(from: string, event: string): void;
  assertTransitionNeverVisited(from: string, event: string): void;
  assertContextNever(predicate: (context: unknown) => boolean): void;
  assertEffectRan(stateName: string): void;
  assertEffectNeverRan(stateName: string): void;
  assertReachedState(stateName: string): void;
  assertNeverReachedState(stateName: string): void;

  wasStateVisited(stateName: string): boolean;
  wasTransitionVisited(from: string, event: string): boolean;
  wasEffectRun(stateName: string): boolean;

  reset(): void;
}
