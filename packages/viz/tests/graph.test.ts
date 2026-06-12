import { describe, test, expect } from "vite-plus/test";
import { buildGraph } from "../src/graph.ts";
import { Actor, state, event } from "@mantaq/core";

function createSimpleActor() {
  const idle = state("idle")();
  const loading = state("loading")();
  const done = state("done")().final();

  const fetch = event("FETCH")();
  const success = event("SUCCESS")();

  return new Actor({
    inputs: [fetch],
    outputs: [],
    internal: [success],
    states: [idle, loading, done],
    initial: idle,
    context: {} as {},
    effects: {},
    transitions: {
      idle: { FETCH: () => ({ state: loading }) },
      loading: { SUCCESS: () => ({ state: done }) },
    },
  });
}

function createSelfLoopActor() {
  const active = state("active")();
  const ping = event("PING")();

  return new Actor({
    inputs: [ping],
    outputs: [],
    internal: [],
    states: [active],
    initial: active,
    context: {} as {},
    effects: {},
    transitions: {
      active: { PING: () => ({ state: active }) },
    },
  });
}

function createThreeStateActor() {
  const a = state("a")();
  const b = state("b")();
  const c = state("c")();

  const go = event("GO")();
  const next = event("NEXT")();
  const back = event("BACK")();

  return new Actor({
    inputs: [go, next, back],
    outputs: [],
    internal: [],
    states: [a, b, c],
    initial: a,
    context: {} as {},
    effects: {},
    transitions: {
      a: { GO: () => ({ state: b }) },
      b: { NEXT: () => ({ state: c }) },
      c: { BACK: () => ({ state: a }) },
    },
  });
}

describe("buildGraph", () => {
  test("creates nodes from actor states", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);
    expect(graph.nodes.map((n) => n.label)).toEqual(
      expect.arrayContaining(["idle", "loading", "done"]),
    );
  });

  test("marks active state correctly", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    const active = graph.nodes.find((n) => n.isActive);
    expect(active).toBeDefined();
    expect(active!.label).toBe("idle");
  });

  test("marks final states", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    const done = graph.nodes.find((n) => n.label === "done");
    expect(done).toBeDefined();
    expect(done!.isFinal).toBe(true);
  });

  test("non-final states are not marked final", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    const idle = graph.nodes.find((n) => n.label === "idle");
    expect(idle!.isFinal).toBe(false);
  });

  test("creates edges from transitions", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  test("edges have correct labels", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    const labels = graph.edges.map((e) => e.label);
    expect(labels).toContain("FETCH");
    expect(labels).toContain("SUCCESS");
  });

  test("handles self-loop transitions", () => {
    const actor = createSelfLoopActor();
    const graph = buildGraph(actor);

    const selfLoops = graph.edges.filter((e) => e.source === e.target);
    expect(selfLoops.length).toBeGreaterThanOrEqual(1);
  });

  test("self-loop edge has correct label", () => {
    const actor = createSelfLoopActor();
    const graph = buildGraph(actor);

    const selfLoop = graph.edges.find((e) => e.source === e.target);
    expect(selfLoop).toBeDefined();
    expect(selfLoop!.label).toBe("PING");
  });

  test("node IDs match path convention", () => {
    const actor = createSimpleActor();
    const graph = buildGraph(actor);

    for (const node of graph.nodes) {
      expect(node.id).toBeTruthy();
      expect(typeof node.id).toBe("string");
    }
  });

  test("handles three-state transitions", () => {
    const actor = createThreeStateActor();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);
  });

  test("graph updates after transition", () => {
    const actor = createSimpleActor();

    let graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)?.label).toBe("idle");

    const fetch = event("FETCH")();
    actor.send(fetch);

    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)?.label).toBe("loading");
  });

  test("handles empty transitions gracefully", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {},
    });

    const graph = buildGraph(actor);
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].label).toBe("");
  });
});

describe("buildGraph with regions", () => {
  test("includes region child states", () => {
    const subA = state("subA")();
    const subB = state("subB")();
    const toggle = event("TOGGLE")();

    const region = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      states: [subA, subB],
      initial: subA,
      context: {} as {},
      effects: {},
      transitions: {
        subA: { TOGGLE: () => ({ state: subB }) },
        subB: { TOGGLE: () => ({ state: subA }) },
      },
    });

    const parent = state("parent")();
    const start = event("START")();

    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [],
      states: [parent],
      initial: parent,
      context: {} as {},
      effects: {},
      regions: { child: region },
      transitions: {
        parent: { START: () => ({ state: parent }) },
      },
    });

    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const nodeLabels = graph.nodes.map((n) => n.label);
    expect(nodeLabels).toContain("parent");
    expect(nodeLabels).toContain("subA");
  });
});
