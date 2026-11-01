import { computeCoverage } from "./coverage.ts";
import { Actor, event, state } from "@mantaq/core";
import type { EffectFn } from "@mantaq/core";
import { buildGraph, createHistory } from "@mantaq/traversal";
import { describe, expect, test } from "vite-plus/test";

function makeActor(effects?: {
  a?: EffectFn<Record<string, unknown>>;
  b?: EffectFn<Record<string, unknown>>;
}) {
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
      machine.on(stateA, { event: goEvent, to: [stateB], handler: () => ({ state: stateB }) });
      machine.on(stateB, { event: stopEvent, to: [stateA], handler: () => ({ state: stateA }) });
      if (effects?.a !== undefined) machine.effect(stateA, { name: "aEffect", fn: effects.a });
      if (effects?.b !== undefined) machine.effect(stateB, { name: "bEffect", fn: effects.b });
    },
  });
}

describe("computeCoverage", () => {
  test("returns 100% state coverage when all states were visited", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "state_visit", data: { stateName: "a" } });
    history.append({ type: "state_visit", data: { stateName: "b" } });

    expect(computeCoverage(graph, { history }).states).toEqual({
      total: 2,
      visited: 2,
      uncovered: [],
    });
  });

  test("returns partial state coverage when some states were missed", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "state_visit", data: { stateName: "a" } });

    expect(computeCoverage(graph, { history }).states).toEqual({
      total: 2,
      visited: 1,
      uncovered: ["b"],
    });
  });

  test("returns 100% transition coverage when all transitions fired", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });
    history.append({
      type: "transition",
      data: { from: "b", event: "STOP", to: "a" },
    });

    expect(computeCoverage(graph, { history }).transitions).toEqual({
      total: 2,
      visited: 2,
      uncovered: [],
    });
  });

  test("returns partial transition coverage when some transitions missed", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });

    expect(computeCoverage(graph, { history }).transitions).toEqual({
      total: 2,
      visited: 1,
      uncovered: [{ from: "b", event: "STOP" }],
    });
  });

  test("returns zero percents instead of NaN when the graph is empty", () => {
    const graph = { nodes: [], edges: [] };
    const history = createHistory();

    expect(computeCoverage(graph, { history }).percent).toEqual({
      states: 0,
      transitions: 0,
      effects: 0,
    });
  });

  test("returns a ran count when the effect record exists in the history", () => {
    function noopEffect(): void {}
    const actor = makeActor({ a: noopEffect });
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "effect", data: { stateName: "a", effectName: "aEffect" } });

    expect(computeCoverage(graph, { history }).effects.ran).toBe(1);
  });

  test("returns never-run effect states as unexecuted", () => {
    function noopEffect(): void {}
    const actor = makeActor({ a: noopEffect, b: noopEffect });
    const graph = buildGraph(actor);
    const history = createHistory();

    history.append({ type: "effect", data: { stateName: "a", effectName: "aEffect" } });

    expect(computeCoverage(graph, { history }).effects.unexecuted).toEqual(["b"]);
  });

  describe("onAny transitions", () => {
    function makeAnyActor() {
      const goEvent = event("GO")();
      const resetEvent = event("RESET")();
      const stateA = state("a")();
      const stateB = state("b")();

      return Actor({
        inputs: [goEvent, resetEvent],
        outputs: [],
        internal: [],
        states: [stateA, stateB],
        initial: stateA,
        setup: (machine) => {
          machine.on(stateA, { event: goEvent, to: [stateB], handler: () => ({ state: stateB }) });
          machine.onAny({
            event: resetEvent,
            to: [stateA],
            handler: () => ({ state: stateA }),
          });
        },
      });
    }

    test("is fully covered once the onAny event fired from any state", () => {
      const graph = buildGraph(makeAnyActor());
      const history = createHistory();

      history.append({ type: "state_visit", data: { stateName: "a" } });
      history.append({ type: "state_visit", data: { stateName: "b" } });
      history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });
      history.append({ type: "transition", data: { from: "b", event: "RESET", to: "a" } });

      const report = computeCoverage(graph, { history });

      expect(report.states).toEqual({ total: 2, visited: 2, uncovered: [] });
      expect(report.transitions).toEqual({ total: 2, visited: 2, uncovered: [] });
    });

    test("reports a never-fired onAny transition as uncovered", () => {
      const graph = buildGraph(makeAnyActor());
      const history = createHistory();

      history.append({ type: "state_visit", data: { stateName: "a" } });
      history.append({ type: "state_visit", data: { stateName: "b" } });
      history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });

      expect(computeCoverage(graph, { history }).transitions.uncovered).toEqual([
        { from: "*", event: "RESET" },
      ]);
    });
  });

  describe("onAny transitions in regions", () => {
    function makeRegionActor() {
      const resetEvent = event("RESET")();
      const idleState = state("idle")();
      const busyState = state("busy")();
      const child = Actor({
        inputs: [resetEvent],
        outputs: [],
        states: [idleState, busyState],
        initial: idleState,
        setup: (machine) => {
          machine.onAny({
            event: resetEvent,
            to: [idleState],
            handler: () => ({ state: idleState }),
          });
        },
      });
      const rootState = state("root")();
      return Actor({
        inputs: [resetEvent],
        outputs: [],
        states: [rootState],
        initial: rootState,
        regions: { r1: child, r2: child },
        setup: (machine) => {
          machine.onAny({
            event: resetEvent,
            to: [rootState],
            handler: () => ({ state: rootState }),
          });
        },
      });
    }

    test("a region onAny is uncovered when RESET fired only in another region or root", () => {
      const graph = buildGraph(makeRegionActor());
      const history = createHistory();

      history.append({ type: "transition", data: { from: "root", event: "RESET", to: "root" } });
      history.append({
        type: "transition",
        data: { from: "r2.idle", event: "RESET", to: "r2.idle" },
      });

      expect(computeCoverage(graph, { history }).transitions.uncovered).toEqual([
        { from: "r1.*", event: "RESET" },
      ]);
    });

    test("a region onAny is covered when RESET fired in that region", () => {
      const graph = buildGraph(makeRegionActor());
      const history = createHistory();

      history.append({ type: "transition", data: { from: "root", event: "RESET", to: "root" } });
      history.append({
        type: "transition",
        data: { from: "r1.idle", event: "RESET", to: "r1.idle" },
      });
      history.append({
        type: "transition",
        data: { from: "r2.idle", event: "RESET", to: "r2.idle" },
      });

      expect(computeCoverage(graph, { history }).transitions.uncovered).toEqual([]);
    });
  });
});
