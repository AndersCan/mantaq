import { describe, it, expect } from "vite-plus/test";
import { explore, testSequences, coverageReport } from "../src/explorer.ts";
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
      { id: "e5", from: "D", to: "C", eventId: "RESUME", isWildcard: false },
    ],
    initial: "A",
  };
}

function makeMultiFinalGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("X", { id: "X", isInitial: true, isFinal: false, effects: [], regions: {} });
  nodes.set("Y", { id: "Y", isInitial: false, isFinal: true, effects: [], regions: {} });
  nodes.set("Z", { id: "Z", isInitial: false, isFinal: true, effects: [], regions: {} });

  return {
    nodes,
    edges: [
      { id: "c1", from: "X", to: "Y", eventId: "A", isWildcard: false },
      { id: "c2", from: "X", to: "Z", eventId: "B", isWildcard: false },
    ],
    initial: "X",
  };
}

describe("explore", () => {
  it("finds paths to final states", () => {
    const paths = explore(makeGraph());
    expect(paths.length).toBeGreaterThanOrEqual(1);
    for (const p of paths) {
      const lastState = p.states[p.states.length - 1];
      const lastNode = makeGraph().nodes.get(lastState);
      expect(lastNode?.isFinal).toBe(true);
    }
  });

  it("respects maxPaths", () => {
    const paths = explore(makeMultiFinalGraph(), { maxPaths: 1 });
    expect(paths.length).toBe(1);
  });

  it("handles multiple final states", () => {
    const paths = explore(makeMultiFinalGraph());
    expect(paths.length).toBe(2);
  });
});

describe("testSequences", () => {
  it("covers all states", () => {
    const seqs = testSequences(makeGraph());
    const visited = new Set<string>();
    for (const s of seqs) {
      for (const state of s.states) visited.add(state);
    }
    for (const id of makeGraph().nodes.keys()) {
      expect(visited.has(id)).toBe(true);
    }
  });

  it("returns shortest first", () => {
    const seqs = testSequences(makeMultiFinalGraph());
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i].states.length).toBeGreaterThanOrEqual(seqs[i - 1].states.length);
    }
  });
});

describe("coverageReport", () => {
  it("calculates full coverage", () => {
    const graph = makeGraph();
    const allStates = [...graph.nodes.keys()];
    const allEdges = graph.edges.map((e) => e.id);
    const report = coverageReport(graph, allStates, allEdges);
    expect(report.stateCoverage).toBe(1);
    expect(report.edgeCoverage).toBe(1);
    expect(report.unreachableStates).toEqual([]);
  });

  it("calculates partial coverage", () => {
    const graph = makeGraph();
    const report = coverageReport(graph, ["A", "B"], ["e1"]);
    expect(report.stateCoverage).toBe(0.5);
    expect(report.edgeCoverage).toBe(0.2);
    expect(report.unreachableStates).toContain("C");
    expect(report.unreachableStates).toContain("D");
  });

  it("identifies dead ends in graph with dead end", () => {
    const nodes = new Map<string, import("../src/types.ts").GraphNode>();
    nodes.set("A", { id: "A", isInitial: true, isFinal: false, effects: [], regions: {} });
    nodes.set("B", { id: "B", isInitial: false, isFinal: false, effects: [], regions: {} });
    const graph: import("../src/types.ts").Graph = {
      nodes,
      edges: [{ id: "e1", from: "A", to: "B", eventId: "GO", isWildcard: false }],
      initial: "A",
    };
    const report = coverageReport(graph, ["A", "B"], ["e1"]);
    expect(report.deadEndStates).toContain("B");
  });
});
