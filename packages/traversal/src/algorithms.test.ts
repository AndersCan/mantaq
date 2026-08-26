import { allPaths, findCycles, reachable, shortestPath, unreachableNodes } from "./algorithms.ts";
import type { ActorGraph } from "./types.ts";
import { describe, expect, test } from "vite-plus/test";

function linearGraph(): ActorGraph {
  return {
    nodes: [
      { id: "a", label: "a", isActive: true, isFinal: false },
      { id: "b", label: "b", isActive: false, isFinal: false },
      { id: "c", label: "c", isActive: false, isFinal: true },
    ],
    edges: [
      { id: "a-go-b", source: "a", target: "b", label: "GO", isActive: true, contexts: [] },
      {
        id: "b-next-c",
        source: "b",
        target: "c",
        label: "NEXT",
        isActive: false,
        contexts: [],
      },
    ],
  };
}

function branchingGraph(): ActorGraph {
  return {
    nodes: [
      { id: "a", label: "a", isActive: true, isFinal: false },
      { id: "b", label: "b", isActive: false, isFinal: false },
      { id: "c", label: "c", isActive: false, isFinal: false },
      { id: "d", label: "d", isActive: false, isFinal: true },
    ],
    edges: [
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true, contexts: [] },
      { id: "a-y-c", source: "a", target: "c", label: "Y", isActive: true, contexts: [] },
      { id: "b-z-d", source: "b", target: "d", label: "Z", isActive: false, contexts: [] },
      { id: "c-w-d", source: "c", target: "d", label: "W", isActive: false, contexts: [] },
    ],
  };
}

function cyclicGraph(): ActorGraph {
  return {
    nodes: [
      { id: "a", label: "a", isActive: true, isFinal: false },
      { id: "b", label: "b", isActive: false, isFinal: false },
      { id: "c", label: "c", isActive: false, isFinal: false },
    ],
    edges: [
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true, contexts: [] },
      { id: "b-y-c", source: "b", target: "c", label: "Y", isActive: false, contexts: [] },
      { id: "c-z-a", source: "c", target: "a", label: "Z", isActive: false, contexts: [] },
    ],
  };
}

function multiCycleGraph(): ActorGraph {
  return {
    nodes: [
      { id: "a", label: "a", isActive: true, isFinal: false },
      { id: "b", label: "b", isActive: false, isFinal: false },
      { id: "c", label: "c", isActive: false, isFinal: false },
    ],
    edges: [
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true, contexts: [] },
      { id: "b-y-a", source: "b", target: "a", label: "Y", isActive: false, contexts: [] },
      { id: "b-z-c", source: "b", target: "c", label: "Z", isActive: false, contexts: [] },
      { id: "c-w-b", source: "c", target: "b", label: "W", isActive: false, contexts: [] },
    ],
  };
}

describe("reachable", () => {
  test("returns true for a directly connected pair", () => {
    expect(reachable(linearGraph(), { fromId: "a", toId: "b" })).toBe(true);
  });

  test("returns true for a transitively connected pair", () => {
    expect(reachable(linearGraph(), { fromId: "a", toId: "c" })).toBe(true);
  });

  test("returns false when no path connects the pair", () => {
    expect(reachable(linearGraph(), { fromId: "c", toId: "a" })).toBe(false);
  });

  test("returns true when start equals target", () => {
    expect(reachable(linearGraph(), { fromId: "a", toId: "a" })).toBe(true);
  });
});

describe("allPaths", () => {
  test("returns the single path through a linear graph", () => {
    expect(allPaths(linearGraph(), { fromId: "a", toId: "c" })).toEqual([["a", "b", "c"]]);
  });

  test("returns every branch path through a branching graph", () => {
    const paths = allPaths(branchingGraph(), { fromId: "a", toId: "d" });
    expect(paths).toEqual([
      ["a", "b", "d"],
      ["a", "c", "d"],
    ]);
  });

  test("returns an empty list when no path exists", () => {
    expect(allPaths(linearGraph(), { fromId: "c", toId: "a" })).toEqual([]);
  });
});

describe("findCycles", () => {
  test("returns no cycles for an acyclic graph", () => {
    expect(findCycles(linearGraph())).toEqual([]);
  });

  test("returns the single cycle in a cyclic graph", () => {
    const cycles = findCycles(cyclicGraph());
    expect(cycles).toEqual([["a", "b", "c", "a"]]);
  });

  test("returns a 2-node cycle once instead of once per rotation", () => {
    const graph: ActorGraph = {
      nodes: [
        { id: "A", label: "A", isActive: true, isFinal: false },
        { id: "B", label: "B", isActive: false, isFinal: false },
      ],
      edges: [
        { id: "a-b", source: "A", target: "B", label: "x", isActive: true, contexts: [] },
        { id: "b-a", source: "B", target: "A", label: "y", isActive: false, contexts: [] },
      ],
    };
    const cycles = findCycles(graph);
    expect(cycles).toEqual([["A", "B", "A"]]);
  });

  test("returns each distinct cycle in a multi-cycle graph", () => {
    const cycles = findCycles(multiCycleGraph());
    expect(cycles.map((cycle) => cycle.join("->"))).toEqual(["a->b->a", "b->c->b"]);
  });

  test("returns a cycle reachable only through an already-visited node", () => {
    const graph: ActorGraph = {
      nodes: [
        { id: "X", label: "X", isActive: true, isFinal: false },
        { id: "Y", label: "Y", isActive: false, isFinal: false },
        { id: "Z", label: "Z", isActive: false, isFinal: false },
        { id: "W", label: "W", isActive: false, isFinal: false },
      ],
      edges: [
        { id: "x-y", source: "X", target: "Y", label: "A", isActive: true, contexts: [] },
        { id: "x-w", source: "X", target: "W", label: "B", isActive: true, contexts: [] },
        { id: "y-z", source: "Y", target: "Z", label: "C", isActive: true, contexts: [] },
        { id: "z-x", source: "Z", target: "X", label: "D", isActive: true, contexts: [] },
        { id: "w-y", source: "W", target: "Y", label: "E", isActive: true, contexts: [] },
      ],
    };
    const cycles = findCycles(graph);
    const joined = cycles.map((cycle) => cycle.slice(0, -1).sort().join("")).sort();
    expect(joined).toEqual(["WXYZ", "XYZ"]);
  });
});

describe("unreachableNodes", () => {
  test("returns the ids that cannot be reached from the origin", () => {
    expect(unreachableNodes(linearGraph(), { fromId: "b" })).toEqual(["a"]);
  });

  test("returns an empty list when everything is reachable from the root", () => {
    expect(unreachableNodes(linearGraph(), { fromId: "a" })).toEqual([]);
  });
});

describe("shortestPath", () => {
  test("returns the direct hop between adjacent nodes", () => {
    expect(shortestPath(linearGraph(), { fromId: "a", toId: "b" })).toEqual(["a", "b"]);
  });

  test("returns the full chain across multiple hops", () => {
    expect(shortestPath(linearGraph(), { fromId: "a", toId: "c" })).toEqual(["a", "b", "c"]);
  });

  test("returns undefined when no path exists", () => {
    expect(shortestPath(linearGraph(), { fromId: "c", toId: "a" })).toBeUndefined();
  });

  test("returns just the start node when it is also the target", () => {
    expect(shortestPath(linearGraph(), { fromId: "a", toId: "a" })).toEqual(["a"]);
  });
});
