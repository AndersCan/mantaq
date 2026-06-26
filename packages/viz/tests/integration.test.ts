import { describe, test, expect } from "vite-plus/test";
import { Actor, state, event } from "@mantaq/core";
import { buildGraph } from "../src/graph.ts";

function createTrafficLight() {
  const green = state("green")();
  const yellow = state("yellow")();
  const red = state("red")();
  const next = event("NEXT")();

  return new Actor({
    inputs: [next],
    outputs: [],
    internal: [],
    states: [green, yellow, red],
    initial: green,
    context: {} as {},
    setup: (m) => {
      m.on(green, next, () => ({ state: yellow }));
      m.on(yellow, next, () => ({ state: red }));
      m.on(red, next, () => ({ state: green }));
    },
  });
}

function createWithRegions() {
  const subA = state("subA")();
  const subB = state("subB")();
  const toggle = event("TOGGLE")();

  const child = new Actor({
    inputs: [toggle],
    outputs: [],
    internal: [],
    states: [subA, subB],
    initial: subA,
    context: {} as {},
    setup: (m) => {
      m.on(subA, toggle, () => ({ state: subB }));
      m.on(subB, toggle, () => ({ state: subA }));
    },
  });

  const parent = state("parent")();
  const start = event("START")();

  return new Actor({
    inputs: [start],
    outputs: [],
    internal: [],
    states: [parent],
    initial: parent,
    context: {} as {},
    regions: { child },
    setup: (m) => {
      m.on(parent, start, () => ({ state: parent }));
    },
  });
}

describe("integration: actor -> graph", () => {
  test("builds graph from traffic light actor", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);

    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("green");
    expect(labels).toContain("yellow");
    expect(labels).toContain("red");
  });

  test("preserves active state", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);

    const activeNodes = graph.nodes.filter((n) => n.isActive);
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0].label).toBe("green");
  });

  test("graph updates after transition", () => {
    const actor = createTrafficLight();
    let graph = buildGraph(actor);

    let active = graph.nodes.find((n) => n.isActive);
    expect(active!.label).toBe("green");

    const next = event("NEXT")();
    actor.send(next.create());

    graph = buildGraph(actor);
    active = graph.nodes.find((n) => n.isActive);
    expect(active!.label).toBe("yellow");
  });

  test("full cycle: green -> yellow -> red -> green", () => {
    const actor = createTrafficLight();
    const next = event("NEXT")();

    let graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("green");

    actor.send(next.create());
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("yellow");

    actor.send(next.create());
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("red");

    actor.send(next.create());
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("green");
  });

  test("handles region actors", () => {
    const actor = createWithRegions();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("parent");
    expect(labels).toContain("subA");
  });

  test("node IDs are unique across the graph", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("edge source/target reference valid node IDs", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
