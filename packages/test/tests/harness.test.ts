import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import { INITIAL_NODE_ID } from "@mantaq/traversal";
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

  test("effect assertions match state and effect name", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();
    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      context: {},
      states: [idle, active],
      initial: idle,
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
        m.effect(active, { name: "logVisit", fn: () => {} });
      },
    });
    const harness = createTestHarness(actor);
    harness.send(go.create(undefined));

    expect(harness.wasEffectRun("active", "logVisit")).toBe(true);
    expect(harness.wasEffectRun("idle", "logVisit")).toBe(false);
    expect(harness.wasEffectRun("active", "other")).toBe(false);
    expect(() => harness.assertEffectRan("active", "logVisit")).not.toThrow();
    expect(() => harness.assertEffectRan("active", "other")).toThrow(/did not run/);
    expect(() => harness.assertEffectNeverRan("active", "other")).not.toThrow();
    expect(() => harness.assertEffectNeverRan("active", "logVisit")).toThrow(/ran/);
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
    expect(() => harness.assertTransitionVisited("a", "GO")).not.toThrow();
    expect(() => harness.assertTransitionVisited("b", "STOP")).not.toThrow();
  });

  test("graph has nodes for states", () => {
    const actor = makeToggle();
    const harness = createTestHarness(actor);

    const stateNodes = harness.graph.nodes.filter((n) => n.id !== INITIAL_NODE_ID);
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

describe("harness with regions", () => {
  test("coverage and assertions observe region child states and transitions", () => {
    const childGo = event("CGO")();
    const childIdle = state("cidle")();
    const childDone = state("cdone")();
    const doneEvt = event("CHILD_DONE")();

    const child = new Actor({
      inputs: [childGo],
      outputs: [doneEvt],
      states: [childIdle, childDone],
      initial: childIdle,
      setup: (m) => {
        m.on(childIdle, childGo, () => ({ state: childDone, emit: [doneEvt.create()] }));
      },
    });

    const parentIdle = state("pidle")();
    const parentActive = state("pactive")();

    const actor = new Actor({
      inputs: [doneEvt],
      states: [parentIdle, parentActive],
      initial: parentIdle,
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, doneEvt, () => ({ state: parentActive }));
      },
    });

    const harness = createTestHarness(actor);
    harness.actor.regions.child.send(childGo.create());

    expect(harness.history.visitedStates().has("child.cidle")).toBe(true);
    expect(harness.history.visitedStates().has("child.cdone")).toBe(true);
    expect(harness.history.firedTransitions().has("child.cidle:CGO")).toBe(true);

    harness.assertAllStatesVisited();
    harness.assertAllTransitionsVisited();

    const cov = harness.coverage();
    expect(cov.states.uncovered).not.toContain("child.cidle");
    expect(cov.states.uncovered).not.toContain("child.cdone");
    expect(cov.transitions.uncovered).not.toContain(
      expect.objectContaining({ from: "child.cidle", event: "CGO" }),
    );
  });
});
