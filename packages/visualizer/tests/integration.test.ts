import { describe, it, expect } from "vite-plus/test";
import { state, event, Actor } from "@mantaq/core";
import { buildGraph } from "../src/graph.ts";
import { computeLayout } from "../src/layout.ts";

describe("integration: actor -> graph -> layout", () => {
  it("produces valid layout from simple actor", async () => {
    const idle = state("idle")();
    const active = state("active")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: { TOGGLE: () => ({ state: active }) },
        active: { TOGGLE: () => ({ state: idle }) },
      },
    });

    const graph = buildGraph(actor);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);

    const layout = await computeLayout(graph);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    for (const node of layout.nodes) {
      expect(node.x).toBeDefined();
      expect(node.y).toBeDefined();
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }

    for (const edge of layout.edges) {
      expect(edge.path).toBeTruthy();
      expect(edge.labelX).toBeDefined();
      expect(edge.labelY).toBeDefined();
    }
  });

  it("preserves active state through pipeline", async () => {
    const idle = state("idle")();
    const active = state("active")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: { TOGGLE: () => ({ state: active }) },
      },
    });

    const graph = buildGraph(actor);
    const layout = await computeLayout(graph);

    const activeNode = layout.nodes.find((n) => n.id === "active");
    expect(activeNode).toBeDefined();
    expect(activeNode!.isActive).toBe(false);

    const idleNode = layout.nodes.find((n) => n.id === "idle");
    expect(idleNode).toBeDefined();
    expect(idleNode!.isActive).toBe(true);
  });

  it("preserves final state through pipeline", async () => {
    const idle = state("idle")();
    const done = state("done")().final();

    const NEXT = event("NEXT")();

    const actor = new Actor({
      inputs: [NEXT],
      states: [idle, done],
      initial: idle,
      transitions: {
        idle: { NEXT: () => ({ state: done }) },
      },
    });

    const graph = buildGraph(actor);
    const layout = await computeLayout(graph);

    const doneNode = layout.nodes.find((n) => n.id === "done");
    expect(doneNode).toBeDefined();
    expect(doneNode!.isFinal).toBe(true);
  });

  it("handles actor with regions through pipeline", async () => {
    const subA = state("subA")();
    const subB = state("subB")();
    const active = state("active")().regions({
      sub: { initial: "subA", states: { subA, subB } },
    });
    const idle = state("idle")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: active,
      transitions: {
        idle: { TOGGLE: () => ({ state: active }) },
      },
    });

    const graph = buildGraph(actor);
    const layout = await computeLayout(graph);

    expect(layout.nodes.length).toBeGreaterThanOrEqual(3);

    const activeNode = layout.nodes.find((n) => n.id === "active");
    expect(activeNode).toBeDefined();

    const subNodes = layout.nodes.filter((n) => n.id.startsWith("active/"));
    expect(subNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("handles layout with direction option", async () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();

    const GO = event("GO")();

    const actor = new Actor({
      inputs: [GO],
      states: [a, b, c],
      initial: a,
      transitions: {
        a: { GO: () => ({ state: b }) },
        b: { GO: () => ({ state: c }) },
      },
    });

    const graph = buildGraph(actor);

    const rightLayout = await computeLayout(graph, { direction: "RIGHT" });
    const downLayout = await computeLayout(graph, { direction: "DOWN" });

    expect(rightLayout.nodes).toHaveLength(3);
    expect(downLayout.nodes).toHaveLength(3);
  });

  it("handles empty graph through pipeline", async () => {
    const graph = { nodes: [], edges: [], activePath: [] };
    const layout = await computeLayout(graph);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});
