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
import { Actor, event, state } from "@mantaq/core";
import { buildGraph, createHistory } from "@mantaq/traversal";
import type { History, HistoryEntry } from "@mantaq/traversal";
import { describe, expect, test } from "vite-plus/test";

function isCountContext(value: unknown): value is { count: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "count" in value &&
    typeof value.count === "number"
  );
}

function makeActor() {
  const goEvent = event("GO")();
  const stopEvent = event("STOP")();
  const stateA = state("a")();
  const stateB = state("b")();

  return Actor({
    inputs: [goEvent, stopEvent],
    outputs: [],
    internal: [],
    states: [stateA, stateB],
    initial: stateA,
    setup: (machine) => {
      machine.on(stateA, { eventRef: goEvent, handler: () => ({ state: stateB }) });
      machine.on(stateB, { eventRef: stopEvent, handler: () => ({ state: stateA }) });
    },
  });
}

function makeActorWithContext() {
  const goEvent = event("GO")();
  const stateA = state("a")();
  const stateB = state("b")();

  return Actor({
    inputs: [goEvent],
    outputs: [],
    internal: [],
    context: { count: 0 },
    states: [stateA, stateB],
    initial: stateA,
    setup: (machine) => {
      machine.on(stateA, {
        eventRef: goEvent,
        handler: (_sentEvent, { context }) => {
          const current = context.get();
          context.set({ ...current, count: current.count + 1 });
          return { state: stateB };
        },
      });
    },
  });
}

function historyWith(...entries: HistoryEntry[]): History {
  const history = createHistory();
  for (const entry of entries) {
    history.append(entry);
  }
  return history;
}

describe("assertAllStatesVisited", () => {
  test("keeps quiet when every graph state has a visit record", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = historyWith(
      { type: "state_visit", data: { stateName: "a" } },
      { type: "state_visit", data: { stateName: "b" } },
    );
    expect(() => assertAllStatesVisited(graph, { history })).not.toThrow();
  });

  test("fails when some graph states have no visit record", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
    expect(() => assertAllStatesVisited(graph, { history })).toThrow(/not visited/);
  });
});

describe("assertAllTransitionsVisited", () => {
  test("keeps quiet when every graph edge has a fired record", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = historyWith(
      { type: "transition", data: { from: "a", event: "GO", to: "b" } },
      { type: "transition", data: { from: "b", event: "STOP", to: "a" } },
    );
    expect(() => assertAllTransitionsVisited(graph, { history })).not.toThrow();
  });

  test("fails when some graph edges have no fired record", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = historyWith({
      type: "transition",
      data: { from: "a", event: "GO", to: "b" },
    });
    expect(() => assertAllTransitionsVisited(graph, { history })).toThrow(/not visited/);
  });
});

describe("assertStateVisited", () => {
  test("keeps quiet when the state was visited", () => {
    const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
    expect(() => assertStateVisited(history, { stateName: "a" })).not.toThrow();
  });

  test("fails when the state was never visited", () => {
    const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
    expect(() => assertStateVisited(history, { stateName: "b" })).toThrow(/not visited/);
  });
});

describe("assertStateNeverVisited", () => {
  test("keeps quiet when the state was never visited", () => {
    const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
    expect(() => assertStateNeverVisited(history, { stateName: "b" })).not.toThrow();
  });

  test("fails when the state was visited", () => {
    const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
    expect(() => assertStateNeverVisited(history, { stateName: "a" })).toThrow(/was visited/);
  });
});

describe("assertTransitionVisited", () => {
  test("keeps quiet when the transition was fired", () => {
    const history = historyWith({
      type: "transition",
      data: { from: "a", event: "GO", to: "b" },
    });
    expect(() => assertTransitionVisited(history, { from: "a", event: "GO" })).not.toThrow();
  });

  test("fails when the transition was never fired", () => {
    const history = historyWith({
      type: "transition",
      data: { from: "a", event: "GO", to: "b" },
    });
    expect(() => assertTransitionVisited(history, { from: "a", event: "STOP" })).toThrow(
      /not visited/,
    );
  });
});

describe("assertTransitionNeverVisited", () => {
  test("keeps quiet when the transition was never fired", () => {
    const history = historyWith({
      type: "transition",
      data: { from: "a", event: "GO", to: "b" },
    });
    expect(() => assertTransitionNeverVisited(history, { from: "a", event: "STOP" })).not.toThrow();
  });

  test("fails when the transition was fired", () => {
    const history = historyWith({
      type: "transition",
      data: { from: "a", event: "GO", to: "b" },
    });
    expect(() => assertTransitionNeverVisited(history, { from: "a", event: "GO" })).toThrow(
      /was visited/,
    );
  });
});

describe("assertContextNever", () => {
  test("keeps quiet when the predicate does not match the context", () => {
    const actor = makeActorWithContext();
    expect(() =>
      assertContextNever(actor, {
        predicate: (context) => isCountContext(context) && context.count > 10,
      }),
    ).not.toThrow();
  });

  test("fails when the predicate matches the context", () => {
    const actor = makeActorWithContext();
    expect(() =>
      assertContextNever(actor, {
        predicate: (context) => isCountContext(context) && context.count === 0,
      }),
    ).toThrow(/predicate matched/);
  });
});

describe("assertEffectRan", () => {
  test("keeps quiet when the effect ran for the state", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() => assertEffectRan(history, { stateName: "a", effectName: "loadA" })).not.toThrow();
  });

  test("fails when the state has no effect records", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() => assertEffectRan(history, { stateName: "b", effectName: "loadB" })).toThrow(
      /did not run/,
    );
  });

  test("fails when the effect name does not match", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() => assertEffectRan(history, { stateName: "a", effectName: "otherEffect" })).toThrow(
      /did not run/,
    );
  });
});

describe("assertEffectNeverRan", () => {
  test("keeps quiet when the effect did not run", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() =>
      assertEffectNeverRan(history, { stateName: "b", effectName: "loadB" }),
    ).not.toThrow();
  });

  test("fails when the effect ran for the state", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() => assertEffectNeverRan(history, { stateName: "a", effectName: "loadA" })).toThrow(
      /ran/,
    );
  });

  test("keeps quiet when the same state ran a different effect", () => {
    const history = historyWith({
      type: "effect",
      data: { stateName: "a", effectName: "loadA" },
    });
    expect(() =>
      assertEffectNeverRan(history, { stateName: "a", effectName: "otherEffect" }),
    ).not.toThrow();
  });
});
