import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import { buildGraph, History } from "@mantaq/traversal";
import { computeCoverage } from "../src/coverage.ts";
import type { EffectFn } from "@mantaq/core";

function makeActor(effects?: Record<string, EffectFn<{}>>) {
  const go = event("GO")();
  const stop = event("STOP")();
  const a = state("a")();
  const b = state("b")();

  return new Actor({
    inputs: [go, stop],
    outputs: [],
    internal: [],
    context: {},
    states: [a, b],
    initial: a,
    setup: (m) => {
      m.on(a, go, () => ({ state: b }));
      m.on(b, stop, () => ({ state: a }));
      if (effects?.a) m.effect(a, { name: "aEffect", fn: effects.a });
      if (effects?.b) m.effect(b, { name: "bEffect", fn: effects.b });
    },
  });
}

describe("computeCoverage", () => {
  test("all states visited → 100% state coverage", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "state_visit", data: { stateName: "a" } });
    history.append({ type: "state_visit", data: { stateName: "b" } });

    const cov = computeCoverage(graph, history);
    expect(cov.states.total).toBeGreaterThanOrEqual(2);
    expect(cov.states.visited).toBeGreaterThanOrEqual(2);
    expect(cov.states.uncovered).toEqual([]);
    expect(cov.percent.states).toBeGreaterThanOrEqual(100);
  });

  test("some states missed → partial coverage", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "state_visit", data: { stateName: "a" } });

    const cov = computeCoverage(graph, history);
    expect(cov.states.visited).toBeGreaterThanOrEqual(1);
    expect(cov.states.uncovered).toContain("b");
    expect(cov.percent.states).toBeLessThan(100);
  });

  test("all transitions visited → 100% transition coverage", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });
    history.append({
      type: "transition",
      data: { from: "b", event: "STOP", to: "a" },
    });

    const cov = computeCoverage(graph, history);
    expect(cov.transitions.visited).toBeGreaterThanOrEqual(2);
    expect(cov.transitions.uncovered).toEqual([]);
    expect(cov.percent.transitions).toBeGreaterThanOrEqual(100);
  });

  test("some transitions missed → partial coverage", () => {
    const actor = makeActor();
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "transition", data: { from: "a", event: "GO", to: "b" } });

    const cov = computeCoverage(graph, history);
    expect(cov.transitions.visited).toBeGreaterThanOrEqual(1);
    expect(cov.transitions.uncovered.length).toBeGreaterThanOrEqual(1);
    expect(cov.percent.transitions).toBeLessThan(100);
  });

  test("empty graph → percent = 0, not NaN", () => {
    const graph = { nodes: [], edges: [] };
    const history = new History();

    const cov = computeCoverage(graph, history);
    expect(cov.percent.states).toBe(0);
    expect(cov.percent.transitions).toBe(0);
    expect(cov.percent.effects).toBe(0);
    expect(cov.states.total).toBe(0);
    expect(cov.transitions.total).toBe(0);
  });

  test("effects coverage", () => {
    const effectFn = () => {};
    const actor = makeActor({ a: effectFn });
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "effect", data: { stateName: "a", effectName: "aEffect" } });

    const cov = computeCoverage(graph, history);
    expect(cov.effects.ran).toBeGreaterThanOrEqual(1);
    expect(cov.effects.total).toBeGreaterThanOrEqual(1);
  });

  test("effects never ran → unexecuted list", () => {
    const effectFn = () => {};
    const actor = makeActor({ a: effectFn, b: effectFn });
    const graph = buildGraph(actor);
    const history = new History();

    history.append({ type: "effect", data: { stateName: "a", effectName: "aEffect" } });

    const cov = computeCoverage(graph, history);
    expect(cov.effects.unexecuted).toContain("b");
  });
});
