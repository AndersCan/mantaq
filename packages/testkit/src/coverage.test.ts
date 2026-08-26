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
      machine.on(stateA, { eventRef: goEvent, handler: () => ({ state: stateB }) });
      machine.on(stateB, { eventRef: stopEvent, handler: () => ({ state: stateA }) });
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
});
