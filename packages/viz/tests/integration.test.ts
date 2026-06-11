// @vitest-environment jsdom
import { describe, it, expect } from "vite-plus/test";
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
    effects: {},
    transitions: {
      green: { NEXT: () => ({ state: yellow }) },
      yellow: { NEXT: () => ({ state: red }) },
      red: { NEXT: () => ({ state: green }) },
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
    effects: {},
    transitions: {
      subA: { TOGGLE: () => ({ state: subB }) },
      subB: { TOGGLE: () => ({ state: subA }) },
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
    effects: {},
    regions: { child },
    transitions: {
      parent: { START: () => ({ state: parent }) },
    },
  });
}

describe("integration: actor -> graph", () => {
  it("builds graph from traffic light actor", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);

    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("green");
    expect(labels).toContain("yellow");
    expect(labels).toContain("red");
  });

  it("preserves active state", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(4);

    const activeNodes = graph.nodes.filter((n) => n.isActive);
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0].label).toBe("green");
  });

  it("graph updates after transition", () => {
    const actor = createTrafficLight();
    let graph = buildGraph(actor);

    let active = graph.nodes.find((n) => n.isActive);
    expect(active!.label).toBe("green");

    const next = event("NEXT")();
    actor.send(next);

    graph = buildGraph(actor);
    active = graph.nodes.find((n) => n.isActive);
    expect(active!.label).toBe("yellow");
  });

  it("full cycle: green -> yellow -> red -> green", () => {
    const actor = createTrafficLight();
    const next = event("NEXT")();

    let graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("green");

    actor.send(next);
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("yellow");

    actor.send(next);
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("red");

    actor.send(next);
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)!.label).toBe("green");
  });

  it("handles region actors", () => {
    const actor = createWithRegions();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("parent");
    expect(labels).toContain("subA");
  });

  it("node IDs are unique across the graph", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("edge source/target reference valid node IDs", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
