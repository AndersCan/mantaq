import { describe, it, expect } from "vite-plus/test";
import { state, event, Actor } from "@mantaq/core";
import {
  buildGraph,
  flattenNodes,
  collectEdges,
  type GraphNode,
  type ActorGraph,
} from "../src/graph.ts";

describe("buildGraph", () => {
  it("builds graph from simple actor", () => {
    const idle = state("idle")();
    const active = state("active")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: {
          TOGGLE: () => ({ state: active }),
        },
        active: {
          TOGGLE: () => ({ state: idle }),
        },
      },
    });

    const graph = buildGraph(actor);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    expect(graph.activePath).toEqual(["idle"]);

    const idleNode = graph.nodes.find((n) => n.id === "idle");
    expect(idleNode).toBeDefined();
    expect(idleNode!.isActive).toBe(true);
    expect(idleNode!.isFinal).toBe(false);
    expect(idleNode!.label).toBe("idle");

    const activeNode = graph.nodes.find((n) => n.id === "active");
    expect(activeNode).toBeDefined();
    expect(activeNode!.isActive).toBe(false);
  });

  it("marks final states", () => {
    const idle = state("idle")();
    const done = state("done")().final();

    const NEXT = event("NEXT")();

    const actor = new Actor({
      inputs: [NEXT],
      states: [idle, done],
      initial: idle,
      transitions: {
        idle: {
          NEXT: () => ({ state: done }),
        },
      },
    });

    const graph = buildGraph(actor);
    const doneNode = graph.nodes.find((n) => n.id === "done");
    expect(doneNode).toBeDefined();
    expect(doneNode!.isFinal).toBe(true);
  });

  it("handles Any wildcard transitions", () => {
    const idle = state("idle")();
    const active = state("active")();

    const NEXT = event("NEXT")();
    const RESET = event("RESET")();

    const actor = new Actor({
      inputs: [NEXT, RESET],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: {
          NEXT: () => ({ state: active }),
        },
        active: {
          NEXT: () => ({ state: idle }),
        },
        Any: {
          RESET: () => ({ state: idle }),
        },
      },
    });

    const graph = buildGraph(actor);

    const resetEdges = graph.edges.filter((e) => e.label === "RESET");
    expect(resetEdges.length).toBe(2);
    expect(resetEdges.every((e) => e.source === "Any")).toBe(true);
  });

  it("creates edges with correct source and target (not self-loops)", () => {
    const idle = state("idle")();
    const active = state("active")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: {
          TOGGLE: () => ({ state: active }),
        },
        active: {
          TOGGLE: () => ({ state: idle }),
        },
      },
    });

    const graph = buildGraph(actor);

    const idleToActive = graph.edges.find((e) => e.source === "idle" && e.target === "active");
    expect(idleToActive).toBeDefined();
    expect(idleToActive!.label).toBe("TOGGLE");

    const activeToIdle = graph.edges.find((e) => e.source === "active" && e.target === "idle");
    expect(activeToIdle).toBeDefined();
    expect(activeToIdle!.label).toBe("TOGGLE");

    const selfLoops = graph.edges.filter((e) => e.source === e.target);
    expect(selfLoops).toHaveLength(0);
  });

  it("marks active edges using full path", () => {
    const subA = state("subA")();
    const subB = state("subB")();
    const active = state("active")().regions({
      sub: { initial: "subA", states: { subA, subB } },
    });
    const idle = state("idle")();

    const TOGGLE = event("TOGGLE")();
    const NEXT = event("NEXT")();

    const actor = new Actor({
      inputs: [TOGGLE, NEXT],
      states: [idle, active],
      initial: active,
      transitions: {
        idle: {
          TOGGLE: () => ({ state: active }),
        },
        active: {
          NEXT: () => ({ state: idle }),
        },
      },
    });

    const graph = buildGraph(actor);

    const activeEdges = graph.edges.filter((e) => e.isActive);
    expect(activeEdges.length).toBeGreaterThan(0);

    for (const edge of activeEdges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });

  it("updates active state after transition", () => {
    const idle = state("idle")();
    const active = state("active")();

    const TOGGLE = event("TOGGLE")();

    const actor = new Actor({
      inputs: [TOGGLE],
      states: [idle, active],
      initial: idle,
      transitions: {
        idle: {
          TOGGLE: () => ({ state: active }),
        },
        active: {
          TOGGLE: () => ({ state: idle }),
        },
      },
    });

    let graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.id === "idle")!.isActive).toBe(true);

    actor.send(TOGGLE.create(undefined as never));
    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.id === "idle")!.isActive).toBe(false);
    expect(graph.nodes.find((n) => n.id === "active")!.isActive).toBe(true);
  });

  it("handles actors with regions", () => {
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
        idle: {
          TOGGLE: () => ({ state: active }),
        },
      },
    });

    const graph = buildGraph(actor);

    const activeNode = graph.nodes.find((n) => n.id === "active");
    expect(activeNode).toBeDefined();
    expect(activeNode!.children.length).toBe(1);

    const regionNode = activeNode!.children[0];
    expect(regionNode.id).toBe("active/sub");
    expect(regionNode.label).toBe("sub");
    expect(regionNode.children.length).toBe(2);

    const subIds = regionNode.children.map((n) => n.id);
    expect(subIds).toContain("active/sub/subA");
    expect(subIds).toContain("active/sub/subB");
  });
});

describe("flattenNodes", () => {
  it("flattens nested node tree", () => {
    const child: GraphNode = {
      id: "child",
      label: "child",
      isActive: false,
      isFinal: false,
      depth: 1,
      children: [],
    };
    const parent: GraphNode = {
      id: "parent",
      label: "parent",
      isActive: true,
      isFinal: false,
      depth: 0,
      children: [child],
    };

    const flat = flattenNodes(parent);
    expect(flat).toHaveLength(2);
    expect(flat.map((n) => n.id)).toEqual(["parent", "child"]);
  });

  it("returns single node with no children", () => {
    const node: GraphNode = {
      id: "solo",
      label: "solo",
      isActive: true,
      isFinal: false,
      depth: 0,
      children: [],
    };

    const flat = flattenNodes(node);
    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe("solo");
  });
});

describe("collectEdges", () => {
  it("returns all edges from graph", () => {
    const graph: ActorGraph = {
      nodes: [],
      edges: [
        { id: "1", source: "a", target: "b", label: "E1", isActive: false },
        { id: "2", source: "b", target: "c", label: "E2", isActive: true },
      ],
      activePath: ["a"],
    };

    const edges = collectEdges(graph);
    expect(edges).toHaveLength(2);
  });
});

describe("edge cases", () => {
  it("handles single-state actor", () => {
    const only = state("only")();
    const actor = new Actor({
      inputs: [],
      states: [only],
      initial: only,
      transitions: {},
    });

    const graph = buildGraph(actor);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.activePath).toEqual(["only"]);
    expect(graph.nodes[0].isActive).toBe(true);
  });

  it("handles actor with no transitions", () => {
    const a = state("a")();
    const b = state("b")();

    const actor = new Actor({
      inputs: [],
      states: [a, b],
      initial: a,
      transitions: {},
    });

    const graph = buildGraph(actor);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);
  });

  it("handles deeply nested regions", () => {
    const leaf = state("leaf")();
    const mid = state("mid")().regions({
      inner: { initial: "leaf", states: { leaf } },
    });
    const root = state("root")().regions({
      outer: { initial: "mid", states: { mid } },
    });

    const GO = event("GO")();

    const actor = new Actor({
      inputs: [GO],
      states: [root],
      initial: root,
      transitions: {
        root: {
          GO: () => ({ state: root }),
        },
      },
    });

    const graph = buildGraph(actor);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe("root");

    const flat = flattenNodes(graph.nodes[0]);
    expect(flat.length).toBeGreaterThanOrEqual(1);
  });

  it("handles Any wildcard with many states", () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const d = state("d")();

    const RESET = event("RESET")();

    const actor = new Actor({
      inputs: [RESET],
      states: [a, b, c, d],
      initial: a,
      transitions: {
        Any: {
          RESET: () => ({ state: a }),
        },
      },
    });

    const graph = buildGraph(actor);
    const resetEdges = graph.edges.filter((e) => e.label === "RESET");
    expect(resetEdges).toHaveLength(4);
    expect(resetEdges.every((e) => e.source === "Any")).toBe(true);

    const targets = resetEdges.map((e) => e.target).sort();
    expect(targets).toEqual(["a", "b", "c", "d"]);
  });

  it("handles multiple events from same state", () => {
    const idle = state("idle")();
    const active = state("active")();
    const error = state("error")();

    const START = event("START")();
    const FAIL = event("FAIL")();

    const actor = new Actor({
      inputs: [START, FAIL],
      states: [idle, active, error],
      initial: idle,
      transitions: {
        idle: {
          START: () => ({ state: active }),
          FAIL: () => ({ state: error }),
        },
      },
    });

    const graph = buildGraph(actor);
    const idleEdges = graph.edges.filter((e) => e.source === "idle");
    expect(idleEdges).toHaveLength(2);

    const startEdge = idleEdges.find((e) => e.label === "START");
    expect(startEdge!.target).toBe("active");

    const failEdge = idleEdges.find((e) => e.label === "FAIL");
    expect(failEdge!.target).toBe("error");
  });

  it("assigns unique edge ids", () => {
    const a = state("a")();
    const b = state("b")();

    const E1 = event("E1")();
    const E2 = event("E2")();

    const actor = new Actor({
      inputs: [E1, E2],
      states: [a, b],
      initial: a,
      transitions: {
        a: {
          E1: () => ({ state: b }),
          E2: () => ({ state: b }),
        },
      },
    });

    const graph = buildGraph(actor);
    const ids = graph.edges.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("edge has undefined guard by default", () => {
    const a = state("a")();
    const b = state("b")();

    const GO = event("GO")();

    const actor = new Actor({
      inputs: [GO],
      states: [a, b],
      initial: a,
      transitions: {
        a: { GO: () => ({ state: b }) },
      },
    });

    const graph = buildGraph(actor);
    const edge = graph.edges.find((e) => e.label === "GO");
    expect(edge).toBeDefined();
    expect(edge!.guard).toBeUndefined();
  });
});
