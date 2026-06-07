import { describe, it, expect } from "vite-plus/test";
import {
  bfs,
  dfs,
  reachable,
  shortestPath,
  allPaths,
  unreachableStates,
  deadEndStates,
  statesFrom,
  eventsFrom,
} from "../src/traverse.ts";
import type { Graph } from "../src/types.ts";

function makeGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("A", { id: "A", isInitial: true, isFinal: false, effects: [], regions: {} });
  nodes.set("B", { id: "B", isInitial: false, isFinal: false, effects: [], regions: {} });
  nodes.set("C", { id: "C", isInitial: false, isFinal: true, effects: [], regions: {} });
  nodes.set("D", { id: "D", isInitial: false, isFinal: false, effects: [], regions: {} });

  return {
    nodes,
    edges: [
      { id: "e1", from: "A", to: "B", eventId: "START", isWildcard: false },
      { id: "e2", from: "B", to: "C", eventId: "STOP", isWildcard: false },
      { id: "e3", from: "A", to: "A", eventId: "RESET", isWildcard: false },
      { id: "e4", from: "B", to: "D", eventId: "PAUSE", isWildcard: false },
    ],
    initial: "A",
  };
}

function makeCycleGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("X", { id: "X", isInitial: true, isFinal: false, effects: [], regions: {} });
  nodes.set("Y", { id: "Y", isInitial: false, isFinal: true, effects: [], regions: {} });
  nodes.set("Z", { id: "Z", isInitial: false, isFinal: false, effects: [], regions: {} });

  return {
    nodes,
    edges: [
      { id: "c1", from: "X", to: "Y", eventId: "GO", isWildcard: false },
      { id: "c2", from: "X", to: "Z", eventId: "WAIT", isWildcard: false },
      { id: "c3", from: "Z", to: "X", eventId: "BACK", isWildcard: false },
      { id: "c4", from: "Z", to: "Y", eventId: "DONE", isWildcard: false },
    ],
    initial: "X",
  };
}

describe("bfs", () => {
  it("finds shortest path A→C", () => {
    const path = bfs(makeGraph(), "A", "C");
    expect(path).not.toBeNull();
    expect(path!.states).toEqual(["A", "B", "C"]);
    expect(path!.events).toEqual(["START", "STOP"]);
  });

  it("returns null for unreachable target", () => {
    expect(bfs(makeGraph(), "C", "A")).toBeNull();
  });

  it("returns single node path when start equals target", () => {
    const path = bfs(makeGraph(), "A", "A");
    expect(path).toEqual({ states: ["A"], events: [] });
  });
});

describe("dfs", () => {
  it("finds all paths A→C", () => {
    const paths = dfs(makeGraph(), "A", "C");
    expect(paths.length).toBe(1);
    expect(paths[0].states).toEqual(["A", "B", "C"]);
  });

  it("finds multiple paths with cycles", () => {
    const paths = dfs(makeCycleGraph(), "X", "Y");
    expect(paths.length).toBe(2);
  });
});

describe("reachable", () => {
  it("returns true for reachable state", () => {
    expect(reachable(makeGraph(), "A", "D")).toBe(true);
  });

  it("returns false for unreachable state", () => {
    expect(reachable(makeGraph(), "D", "A")).toBe(false);
  });
});

describe("shortestPath", () => {
  it("returns same as bfs", () => {
    const path = shortestPath(makeGraph(), "A", "C");
    expect(path).toEqual(bfs(makeGraph(), "A", "C"));
  });
});

describe("allPaths", () => {
  it("finds all paths in graph with cycles", () => {
    const paths = allPaths(makeCycleGraph(), "X", "Y");
    expect(paths.length).toBe(2);
  });

  it("respects maxDepth", () => {
    const paths = allPaths(makeCycleGraph(), "X", "Y", 1);
    expect(paths.length).toBe(1);
    expect(paths[0].states).toEqual(["X", "Y"]);
  });
});

describe("unreachableStates", () => {
  it("finds no unreachable states in fully connected graph", () => {
    expect(unreachableStates(makeGraph())).toEqual([]);
  });

  it("finds unreachable states in disconnected graph", () => {
    const nodes = new Map<string, import("../src/types.ts").GraphNode>();
    nodes.set("A", { id: "A", isInitial: true, isFinal: false, effects: [], regions: {} });
    nodes.set("B", { id: "B", isInitial: false, isFinal: false, effects: [], regions: {} });
    const graph: Graph = {
      nodes,
      edges: [],
      initial: "A",
    };
    expect(unreachableStates(graph)).toEqual(["B"]);
  });
});

describe("deadEndStates", () => {
  it("finds dead end states", () => {
    const deadEnds = deadEndStates(makeGraph());
    expect(deadEnds).toContain("D");
    expect(deadEnds).not.toContain("C");
  });

  it("returns empty for graph with no dead ends", () => {
    const nodes = new Map<string, import("../src/types.ts").GraphNode>();
    nodes.set("A", { id: "A", isInitial: true, isFinal: false, effects: [], regions: {} });
    nodes.set("B", { id: "B", isInitial: false, isFinal: true, effects: [], regions: {} });
    const graph: Graph = {
      nodes,
      edges: [{ id: "e1", from: "A", to: "B", eventId: "GO", isWildcard: false }],
      initial: "A",
    };
    expect(deadEndStates(graph)).toEqual([]);
  });
});

describe("statesFrom", () => {
  it("returns direct successors", () => {
    expect(statesFrom(makeGraph(), "A")).toEqual(["B", "A"]);
  });

  it("returns empty for state with no outgoing edges", () => {
    expect(statesFrom(makeGraph(), "D")).toEqual([]);
  });
});

describe("eventsFrom", () => {
  it("returns unique events from state", () => {
    const events = eventsFrom(makeGraph(), "A");
    expect(events).toContain("START");
    expect(events).toContain("RESET");
  });

  it("returns empty for state with no outgoing edges", () => {
    expect(eventsFrom(makeGraph(), "D")).toEqual([]);
  });
});
