import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import { createTestHarness } from "../src/index.ts";

function makeToggle() {
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
    },
  });
}

describe("harness", () => {
  test("returns harness with history, graph, coverage", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    expect(harness.history).toBeDefined();
    expect(harness.graph).toBeDefined();
    expect(typeof harness.coverage).toBe("function");
    expect(harness.history.entries().length).toBeGreaterThanOrEqual(0);
  });

  test("send() records to history", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);
    const go = event("GO")();

    harness.send(go.create(undefined));

    expect(harness.history.visitedStates().has("a")).toBe(true);
    expect(harness.history.visitedStates().has("b")).toBe(true);
    expect(harness.history.firedTransitions().has("a:GO")).toBe(true);
  });

  test("state proxies correctly", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    expect(harness.state.name).toBe("a");

    const go = event("GO")();
    harness.send(go.create(undefined));
    expect(harness.state.name).toBe("b");
  });

  test("snapshot() proxies correctly", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    const snap = harness.snapshot();
    expect(snap.path).toEqual(["a"]);
  });

  test("reset() clears history", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);
    const go = event("GO")();

    harness.send(go.create(undefined));
    expect(harness.history.entries().length).toBeGreaterThan(0);

    harness.reset();
    expect(harness.history.entries()).toEqual([]);
  });

  test("wasStateVisited / wasTransitionVisited", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    expect(harness.wasStateVisited("b")).toBe(false);
    expect(harness.wasTransitionVisited("a", "GO")).toBe(false);

    const go = event("GO")();
    harness.send(go.create(undefined));

    expect(harness.wasStateVisited("a")).toBe(true);
    expect(harness.wasStateVisited("b")).toBe(true);
    expect(harness.wasTransitionVisited("a", "GO")).toBe(true);
    expect(harness.wasTransitionVisited("a", "STOP")).toBe(false);
  });

  test("full lifecycle: create → send → coverage → assert", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);
    const go = event("GO")();
    const stop = event("STOP")();

    harness.send(go.create(undefined));
    harness.send(stop.create(undefined));

    const cov = harness.coverage();
    expect(cov.states.total).toBeGreaterThanOrEqual(2);
    expect(cov.states.visited).toBeGreaterThanOrEqual(2);
    expect(cov.percent.states).toBeGreaterThanOrEqual(100);

    expect(() => harness.assertStateVisited("a")).not.toThrow();
    expect(() => harness.assertStateVisited("b")).not.toThrow();
    expect(() => harness.assertReachedState("a")).not.toThrow();
    expect(() => harness.assertTransitionVisited("a", "GO")).not.toThrow();
    expect(() => harness.assertTransitionVisited("b", "STOP")).not.toThrow();
  });

  test("graph has nodes for states", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    const stateNodes = harness.graph.nodes.filter((n) => n.id !== "__initial__");
    expect(stateNodes.length).toBeGreaterThanOrEqual(2);
    const labels = stateNodes.map((n) => n.label);
    expect(labels).toContain("a");
    expect(labels).toContain("b");
  });

  test("accepts an actor with a typed context", () => {
    const idle = state("idle")();
    const tick = event("TICK")();
    const actor = new Actor({
      inputs: [tick],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: { count: 0 },
      setup: (m) => {
        m.on(idle, tick, (_e, { context }) => {
          const s = context.get();
          context.set({ ...s, count: s.count + 1 });
          return {};
        });
      },
    });
    const harness = createTestHarness(actor);
    expect(harness.context?.count).toBe(0);
    const go = event("TICK")();
    harness.send(go.create(undefined));
    expect(harness.context?.count).toBe(1);
    expect(harness.snapshot().context.count).toBe(1);
  });
});
