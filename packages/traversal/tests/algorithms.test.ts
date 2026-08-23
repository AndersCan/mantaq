import { expect, test, describe } from "vite-plus/test";
import {
  reachable,
  allPaths,
  findCycles,
  unreachableNodes,
  shortestPath,
} from "../src/algorithms.ts";
import type { ActorGraph } from "../src/types.ts";

function linearGraph(): ActorGraph {
  return {
    nodes: [
      { id: "a", label: "a", isActive: true, isFinal: false },
      { id: "b", label: "b", isActive: false, isFinal: false },
      { id: "c", label: "c", isActive: false, isFinal: true },
    ],
    edges: [
      { id: "a-go-b", source: "a", target: "b", label: "GO", isActive: true },
      { id: "b-next-c", source: "b", target: "c", label: "NEXT", isActive: false },
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
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true },
      { id: "a-y-c", source: "a", target: "c", label: "Y", isActive: true },
      { id: "b-z-d", source: "b", target: "d", label: "Z", isActive: false },
      { id: "c-w-d", source: "c", target: "d", label: "W", isActive: false },
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
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true },
      { id: "b-y-c", source: "b", target: "c", label: "Y", isActive: false },
      { id: "c-z-a", source: "c", target: "a", label: "Z", isActive: false },
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
      { id: "a-x-b", source: "a", target: "b", label: "X", isActive: true },
      { id: "b-y-a", source: "b", target: "a", label: "Y", isActive: false },
      { id: "b-z-c", source: "b", target: "c", label: "Z", isActive: false },
      { id: "c-w-b", source: "c", target: "b", label: "W", isActive: false },
    ],
  };
}

describe("reachable", () => {
  test("direct path", () => {
    expect(reachable(linearGraph(), "a", "b")).toBe(true);
  });

  test("indirect path", () => {
    expect(reachable(linearGraph(), "a", "c")).toBe(true);
  });

  test("no path", () => {
    expect(reachable(linearGraph(), "c", "a")).toBe(false);
  });

  test("same node is reachable", () => {
    expect(reachable(linearGraph(), "a", "a")).toBe(true);
  });
});

describe("allPaths", () => {
  test("linear graph has one path", () => {
    const paths = allPaths(linearGraph(), "a", "c");
    expect(paths.length).toBe(1);
    expect(paths[0]).toEqual(["a", "b", "c"]);
  });

  test("branching graph has multiple paths", () => {
    const paths = allPaths(branchingGraph(), "a", "d");
    expect(paths.length).toBe(2);
    const pathStrs = paths.map((p) => p.join("->"));
    expect(pathStrs).toContain("a->b->d");
    expect(pathStrs).toContain("a->c->d");
  });

  test("no path returns empty", () => {
    const paths = allPaths(linearGraph(), "c", "a");
    expect(paths.length).toBe(0);
  });
});

describe("findCycles", () => {
  test("no cycles", () => {
    const cycles = findCycles(linearGraph());
    expect(cycles.length).toBe(0);
  });

  test("one cycle", () => {
    const cycles = findCycles(cyclicGraph());
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const hasABC = cycles.some((c) => c.includes("a") && c.includes("b") && c.includes("c"));
    expect(hasABC).toBe(true);
  });

  test("multiple cycles", () => {
    const cycles = findCycles(multiCycleGraph());
    expect(cycles.length).toBeGreaterThanOrEqual(2);
  });

  test("cycle reachable only through an already-visited node is found", () => {
    const graph: ActorGraph = {
      nodes: [
        { id: "X", label: "X", isActive: true, isFinal: false },
        { id: "Y", label: "Y", isActive: false, isFinal: false },
        { id: "Z", label: "Z", isActive: false, isFinal: false },
        { id: "W", label: "W", isActive: false, isFinal: false },
      ],
      edges: [
        { id: "x-y", source: "X", target: "Y", label: "A", isActive: true },
        { id: "x-w", source: "X", target: "W", label: "B", isActive: true },
        { id: "y-z", source: "Y", target: "Z", label: "C", isActive: true },
        { id: "z-x", source: "Z", target: "X", label: "D", isActive: true },
        { id: "w-y", source: "W", target: "Y", label: "E", isActive: true },
      ],
    };
    const cycles = findCycles(graph);
    const hasShort = cycles.some((c) => c.includes("X") && c.includes("Y") && c.includes("Z"));
    const hasLong = cycles.some(
      (c) => c.includes("X") && c.includes("W") && c.includes("Y") && c.includes("Z"),
    );
    expect(hasShort).toBe(true);
    expect(hasLong).toBe(true);
  });
});

describe("unreachableNodes", () => {
  test("some unreachable", () => {
    const unreachable = unreachableNodes(linearGraph(), "b");
    expect(unreachable).toContain("a");
    expect(unreachable).not.toContain("b");
    expect(unreachable).not.toContain("c");
  });

  test("all reachable from root", () => {
    const unreachable = unreachableNodes(linearGraph(), "a");
    expect(unreachable.length).toBe(0);
  });
});

describe("shortestPath", () => {
  test("direct path", () => {
    const path = shortestPath(linearGraph(), "a", "b");
    expect(path).toEqual(["a", "b"]);
  });

  test("indirect path", () => {
    const path = shortestPath(linearGraph(), "a", "c");
    expect(path).toEqual(["a", "b", "c"]);
  });

  test("no path returns null", () => {
    const path = shortestPath(linearGraph(), "c", "a");
    expect(path).toBeNull();
  });

  test("same node", () => {
    const path = shortestPath(linearGraph(), "a", "a");
    expect(path).toEqual(["a"]);
  });
});
