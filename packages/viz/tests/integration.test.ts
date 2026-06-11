// @vitest-environment jsdom
import { describe, it, expect } from "vite-plus/test";
import { Actor, state, event } from "@mantaq/core";
import { buildGraph } from "../src/graph.ts";
import { actorGraphToFlow, toReactFlowNodes, toReactFlowEdges } from "../src/react-flow-adapter.ts";

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

describe("integration: actor -> graph -> react flow", () => {
  it("builds graph from traffic light actor", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(3);

    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("green");
    expect(labels).toContain("yellow");
    expect(labels).toContain("red");
  });

  it("converts graph to React Flow nodes", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);
    const nodes = toReactFlowNodes(graph.nodes);

    expect(nodes.length).toBe(3);
    for (const node of nodes) {
      expect(node.type).toBe("state");
      expect(node.data).toBeDefined();
      expect(typeof node.data.label).toBe("string");
      expect(typeof node.data.isActive).toBe("boolean");
      expect(typeof node.data.isFinal).toBe("boolean");
    }
  });

  it("converts graph to React Flow edges", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);
    const edges = toReactFlowEdges(graph.edges);

    expect(edges.length).toBeGreaterThanOrEqual(3);
    for (const edge of edges) {
      expect(edge.type).toBe("state-edge");
      expect(typeof edge.source).toBe("string");
      expect(typeof edge.target).toBe("string");
      expect(typeof edge.label).toBe("string");
    }
  });

  it("full conversion preserves active state", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);
    const flow = actorGraphToFlow(graph);

    expect(flow.nodes.length).toBe(3);
    expect(flow.edges.length).toBeGreaterThanOrEqual(3);

    const activeNodes = flow.nodes.filter((n) => n.data.isActive);
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0].data.label).toBe("green");
  });

  it("graph updates after transition", () => {
    const actor = createTrafficLight();
    let graph = buildGraph(actor);
    let flow = actorGraphToFlow(graph);

    let active = flow.nodes.find((n) => n.data.isActive);
    expect(active!.data.label).toBe("green");

    const next = event("NEXT")();
    actor.send(next);

    graph = buildGraph(actor);
    flow = actorGraphToFlow(graph);
    active = flow.nodes.find((n) => n.data.isActive);
    expect(active!.data.label).toBe("yellow");
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

    const flow = actorGraphToFlow(graph);
    expect(flow.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("node IDs are consistent between graph and flow", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);
    const flow = actorGraphToFlow(graph);

    const graphIds = new Set(graph.nodes.map((n) => n.id));
    const flowIds = new Set(flow.nodes.map((n) => n.id));
    expect(flowIds).toEqual(graphIds);
  });

  it("edge source/target reference valid node IDs", () => {
    const actor = createTrafficLight();
    const graph = buildGraph(actor);
    const flow = actorGraphToFlow(graph);

    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    for (const edge of flow.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
