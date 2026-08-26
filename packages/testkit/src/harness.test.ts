import { createTestHarness } from "./harness.ts";
import { Actor, event, state } from "@mantaq/core";
import { INITIAL_NODE_ID } from "@mantaq/traversal";
import { describe, expect, test } from "vite-plus/test";

function makeToggleActor() {
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

describe("createTestHarness", () => {
  test("returns a harness exposing history, graph and coverage", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);

    expect(typeof harness.coverage).toBe("function");
    expect(harness.history.entries()).toEqual([{ type: "state_visit", data: { stateName: "a" } }]);
  });

  test("adds history entries when events are sent through the harness", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);
    const goEvent = event("GO")();

    harness.send(goEvent.create());

    expect(harness.history.visitedStates()).toEqual(new Set(["a", "b"]));
    expect(harness.history.firedTransitions()).toEqual(new Set(["a:GO"]));
  });

  test("updates the proxied state after sends", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);
    const goEvent = event("GO")();

    harness.send(goEvent.create());
    expect(harness.state.name).toBe("b");
  });

  test("returns snapshots that read through to the wrapped actor", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);

    expect(harness.snapshot().path).toEqual(["a"]);
  });

  test("deletes every history entry on reset", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);
    const goEvent = event("GO")();

    harness.send(goEvent.create());
    harness.reset();
    expect(harness.history.entries()).toEqual([]);
  });

  test("resolves visited queries for states and transitions", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);
    const goEvent = event("GO")();

    expect(harness.wasStateVisited("b")).toBe(false);
    expect(harness.wasTransitionVisited({ from: "a", event: "GO" })).toBe(false);

    harness.send(goEvent.create());

    expect(harness.wasStateVisited("a")).toBe(true);
    expect(harness.wasStateVisited("b")).toBe(true);
    expect(harness.wasTransitionVisited({ from: "a", event: "GO" })).toBe(true);
    expect(harness.wasTransitionVisited({ from: "a", event: "STOP" })).toBe(false);
  });

  test("validates effect runs against state and effect name", () => {
    const idleState = state("idle")();
    const activeState = state("active")();
    const goEvent = event("GO")();
    const actor = Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState, activeState],
      initial: idleState,
      setup: (machine) => {
        machine.on(idleState, { eventRef: goEvent, handler: () => ({ state: activeState }) });
        machine.effect(activeState, { name: "logVisit", fn: () => {} });
      },
    });
    const harness = createTestHarness(actor);
    harness.send(goEvent.create());

    expect(() =>
      harness.assertEffectRan({ stateName: "active", effectName: "logVisit" }),
    ).not.toThrow();
    expect(() => harness.assertEffectRan({ stateName: "active", effectName: "other" })).toThrow(
      /did not run/,
    );
    expect(() =>
      harness.assertEffectNeverRan({ stateName: "active", effectName: "other" }),
    ).not.toThrow();
    expect(() =>
      harness.assertEffectNeverRan({ stateName: "active", effectName: "logVisit" }),
    ).toThrow(/ran/);
  });

  test("returns full coverage assertions across the create-send-assert lifecycle", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);
    const goEvent = event("GO")();
    const stopEvent = event("STOP")();

    harness.send(goEvent.create());
    harness.send(stopEvent.create());

    expect(harness.coverage().states).toEqual({
      total: 2,
      visited: 2,
      uncovered: [],
    });

    expect(() => harness.assertStateVisited({ stateName: "a" })).not.toThrow();
    expect(() => harness.assertTransitionVisited({ from: "b", event: "STOP" })).not.toThrow();
  });

  test("builds graph nodes for every declared state", () => {
    const actor = makeToggleActor();
    const harness = createTestHarness(actor);

    const labels = harness.graph.nodes
      .filter((node) => node.id !== INITIAL_NODE_ID)
      .map((node) => node.label);
    expect(labels).toEqual(["a", "b"]);
  });

  test("tracks typed context updates through the proxied context getter", () => {
    const idleState = state("idle")();
    const tickEvent = event("TICK")();
    const actor = Actor({
      inputs: [tickEvent],
      outputs: [],
      internal: [],
      states: [idleState],
      initial: idleState,
      context: { count: 0 },
      setup: (machine) => {
        machine.on(idleState, {
          eventRef: tickEvent,
          handler: (_sentEvent, { context }) => {
            const current = context.get();
            context.set({ ...current, count: current.count + 1 });
            return {};
          },
        });
      },
    });
    const harness = createTestHarness(actor);

    harness.send(tickEvent.create());
    expect(harness.context).toEqual({ count: 1 });
  });
});

describe("createTestHarness with regions", () => {
  test("adds region child states and transitions to coverage and assertions", () => {
    const childGoEvent = event("CGO")();
    const childIdleState = state("cidle")();
    const childDoneState = state("cdone")();
    const childDoneEvent = event("CHILD_DONE")();

    const child = Actor({
      inputs: [childGoEvent],
      outputs: [childDoneEvent],
      states: [childIdleState, childDoneState],
      initial: childIdleState,
      setup: (machine) => {
        machine.on(childIdleState, {
          eventRef: childGoEvent,
          handler: () => ({ state: childDoneState, emit: [childDoneEvent.create()] }),
        });
      },
    });

    const parentIdleState = state("pidle")();
    const parentActiveState = state("pactive")();

    const actor = Actor({
      inputs: [childDoneEvent],
      states: [parentIdleState, parentActiveState],
      initial: parentIdleState,
      regions: { child },
      setup: (machine) => {
        machine.on(parentIdleState, {
          eventRef: childDoneEvent,
          handler: () => ({ state: parentActiveState }),
        });
      },
    });

    const harness = createTestHarness(actor);
    harness.actor.regions.child.send(childGoEvent.create());

    expect(harness.history.visitedStates()).toEqual(
      new Set(["pidle", "child.cidle", "child.cdone", "pactive"]),
    );
    expect(harness.history.firedTransitions()).toEqual(
      new Set(["child.cidle:CGO", "pidle:CHILD_DONE"]),
    );

    expect(() => {
      harness.assertAllStatesVisited();
      harness.assertAllTransitionsVisited();
    }).not.toThrow();

    expect(harness.coverage().states.uncovered).toEqual([]);
  });
});
