import { describe, it, expect } from "vite-plus/test";
import { exportGraph, toMermaid, toDot, toJson } from "../src/export.ts";
import type { Graph } from "../src/types.ts";

function simpleGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("Idle", {
    id: "Idle",
    isInitial: true,
    isFinal: false,
    effects: ["idleEffect"],
    regions: {},
  });
  nodes.set("Running", {
    id: "Running",
    isInitial: false,
    isFinal: false,
    effects: [],
    regions: {},
  });
  nodes.set("Done", {
    id: "Done",
    isInitial: false,
    isFinal: true,
    effects: ["doneEffect"],
    regions: {},
  });

  return {
    nodes,
    edges: [
      { id: "e1", from: "Idle", to: "Running", eventId: "START", isWildcard: false },
      { id: "e2", from: "Running", to: "Done", eventId: "FINISH", isWildcard: false },
    ],
    initial: "Idle",
  };
}

function wildcardGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("A", {
    id: "A",
    isInitial: true,
    isFinal: false,
    effects: [],
    regions: {},
  });
  nodes.set("B", {
    id: "B",
    isInitial: false,
    isFinal: true,
    effects: [],
    regions: {},
  });

  return {
    nodes,
    edges: [{ id: "e1", from: "A", to: "B", eventId: "GO", isWildcard: true }],
    initial: "A",
  };
}

function hierarchicalGraph(): Graph {
  const innerNodes = new Map<string, import("../src/types.ts").GraphNode>();
  innerNodes.set("SubA", {
    id: "SubA",
    isInitial: true,
    isFinal: false,
    effects: [],
    regions: {},
  });
  innerNodes.set("SubB", {
    id: "SubB",
    isInitial: false,
    isFinal: true,
    effects: [],
    regions: {},
  });

  const innerGraph: Graph = {
    nodes: innerNodes,
    edges: [{ id: "se1", from: "SubA", to: "SubB", eventId: "NEXT", isWildcard: false }],
    initial: "SubA",
  };

  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("Parent", {
    id: "Parent",
    isInitial: true,
    isFinal: false,
    effects: [],
    regions: { inner: innerGraph },
  });

  return {
    nodes,
    edges: [],
    initial: "Parent",
  };
}

describe("exportGraph", () => {
  it("dispatches to correct format", () => {
    const g = simpleGraph();
    expect(exportGraph(g, "json")).toBe(toJson(g));
    expect(exportGraph(g, "dot")).toBe(toDot(g));
    expect(exportGraph(g, "mermaid")).toBe(toMermaid(g));
  });
});

describe("toMermaid", () => {
  it("produces valid stateDiagram for simple graph", () => {
    const m = toMermaid(simpleGraph());
    expect(m).toContain("stateDiagram-v2");
    expect(m).toContain("[*] --> Idle");
    expect(m).toContain("Idle --> Running : START");
    expect(m).toContain("Running --> Done : FINISH");
    expect(m).toContain("Done --> [*]");
  });

  it("handles wildcard edges with note", () => {
    const m = toMermaid(wildcardGraph());
    expect(m).toContain("A --> B : GO");
    expect(m).toContain("note right of B: wildcard transition");
  });

  it("handles hierarchical states with regions", () => {
    const m = toMermaid(hierarchicalGraph());
    expect(m).toContain("state Parent {");
    expect(m).toContain("state inner {");
    expect(m).toContain("[*] --> SubA");
    expect(m).toContain("SubA --> SubB : NEXT");
  });
});

describe("toDot", () => {
  it("produces valid DOT for simple graph", () => {
    const d = toDot(simpleGraph());
    expect(d).toContain("digraph G {");
    expect(d).toContain('shape=point, label=""');
    expect(d).toContain('shape=doublecircle, label="Done"');
    expect(d).toContain('Idle -> Running [label="START"]');
    expect(d).toContain('Running -> Done [label="FINISH"]');
    expect(d).toContain("}");
  });

  it("uses dashed style for wildcard edges", () => {
    const d = toDot(wildcardGraph());
    expect(d).toContain("style=dashed");
    expect(d).toContain('A -> B [label="GO"');
  });

  it("handles hierarchical states", () => {
    const d = toDot(hierarchicalGraph());
    expect(d).toContain('shape=circle, label="SubA"');
    expect(d).toContain('SubA -> SubB [label="NEXT"]');
  });
});

describe("toJson", () => {
  it("produces valid JSON for simple graph", () => {
    const j = toJson(simpleGraph());
    const parsed = JSON.parse(j) as {
      nodes: Array<{ id: string; isInitial: boolean; isFinal: boolean }>;
      edges: Array<{ from: string; to: string; eventId: string }>;
      initial: string;
    };
    expect(parsed.initial).toBe("Idle");
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(2);

    const idle = parsed.nodes.find((n) => n.id === "Idle")!;
    expect(idle.isInitial).toBe(true);
    expect(idle.isFinal).toBe(false);

    const done = parsed.nodes.find((n) => n.id === "Done")!;
    expect(done.isFinal).toBe(true);
  });

  it("includes children for regions", () => {
    const j = toJson(hierarchicalGraph());
    const parsed = JSON.parse(j) as {
      nodes: Array<{ id: string; children?: Record<string, unknown> }>;
    };
    const parent = parsed.nodes.find((n) => n.id === "Parent")!;
    expect(parent.children).toBeDefined();
    const inner = parent.children!.inner as {
      nodes: Array<{ id: string }>;
      initial: string;
    };
    expect(inner.nodes).toHaveLength(2);
    expect(inner.initial).toBe("SubA");
  });
});
