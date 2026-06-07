import { describe, it, expect } from "vite-plus/test";
import { llmContext, llmToolDefinitions, llmToolHandler } from "../src/llm.ts";
import type { Graph } from "../src/types.ts";

function testGraph(): Graph {
  const nodes = new Map<string, import("../src/types.ts").GraphNode>();
  nodes.set("Idle", {
    id: "Idle",
    isInitial: true,
    isFinal: false,
    effects: ["idleEffect"],
    regions: {},
  });
  nodes.set("Active", {
    id: "Active",
    isInitial: false,
    isFinal: false,
    effects: ["activeEffect"],
    regions: {},
  });
  nodes.set("Done", {
    id: "Done",
    isInitial: false,
    isFinal: true,
    effects: [],
    regions: {},
  });

  return {
    nodes,
    edges: [
      { id: "e1", from: "Idle", to: "Active", eventId: "START", isWildcard: false },
      { id: "e2", from: "Active", to: "Done", eventId: "FINISH", isWildcard: false },
      { id: "e3", from: "Active", to: "Idle", eventId: "RESET", isWildcard: false },
    ],
    initial: "Idle",
  };
}

function mockActor(stateName: string) {
  return {
    state: { name: stateName },
    snapshot: () => ({ path: [stateName], regions: {} }),
    regions: {},
  };
}

describe("llmContext", () => {
  it("returns correct current state and transitions", () => {
    const actor = mockActor("Active");
    const graph = testGraph();
    const ctx = llmContext(actor as never, graph);

    expect(ctx.currentState).toBe("Active");
    expect(ctx.possibleTransitions).toHaveLength(2);
    expect(ctx.possibleTransitions.map((t) => t.eventId)).toContain("FINISH");
    expect(ctx.possibleTransitions.map((t) => t.eventId)).toContain("RESET");
    expect(ctx.activeEffects).toEqual(["activeEffect"]);
    expect(ctx.isFinal).toBe(false);
    expect(ctx.stateInGraph).toBe(true);
  });

  it("detects final state", () => {
    const actor = mockActor("Done");
    const graph = testGraph();
    const ctx = llmContext(actor as never, graph);

    expect(ctx.isFinal).toBe(true);
    expect(ctx.possibleTransitions).toHaveLength(0);
  });

  it("includes graph summary", () => {
    const actor = mockActor("Idle");
    const graph = testGraph();
    const ctx = llmContext(actor as never, graph);

    expect(ctx.graphSummary).toContain("3 states");
    expect(ctx.graphSummary).toContain("3 edges");
    expect(ctx.graphSummary).toContain("1 final states");
    expect(ctx.graphSummary).toContain('"Idle"');
  });

  it("returns stateInGraph false for unknown state", () => {
    const actor = mockActor("Unknown");
    const graph = testGraph();
    const ctx = llmContext(actor as never, graph);

    expect(ctx.stateInGraph).toBe(false);
    expect(ctx.currentState).toBe("Unknown");
    expect(ctx.possibleTransitions).toHaveLength(0);
    expect(ctx.activeEffects).toEqual([]);
    expect(ctx.isFinal).toBe(false);
  });
});

describe("llmToolDefinitions", () => {
  it("returns array of tool definitions", () => {
    const defs = llmToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs).toHaveLength(4);

    const names = defs.map((d) => d.function.name);
    expect(names).toContain("get_current_state");
    expect(names).toContain("get_possible_transitions");
    expect(names).toContain("get_graph_summary");
    expect(names).toContain("check_reachable");

    for (const def of defs) {
      expect(def).toHaveProperty("type", "function");
      expect(def).toHaveProperty("function.name");
      expect(def).toHaveProperty("function.description");
      expect(def).toHaveProperty("function.parameters");
    }
  });
});

describe("llmToolHandler", () => {
  it("handles get_current_state", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler("get_current_state", {}, actor, testGraph());
    expect(result).toEqual({
      state: "Idle",
      isFinal: false,
      effects: ["idleEffect"],
    });
  });

  it("handles get_current_state for unknown state", () => {
    const actor = mockActor("Unknown") as never;
    const result = llmToolHandler("get_current_state", {}, actor, testGraph()) as {
      state: string;
      isFinal: boolean;
      effects: string[];
    };
    expect(result.state).toBe("Unknown");
    expect(result.isFinal).toBe(false);
    expect(result.effects).toEqual([]);
  });

  it("handles get_possible_transitions", () => {
    const actor = mockActor("Active") as never;
    const result = llmToolHandler("get_possible_transitions", {}, actor, testGraph());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("handles get_graph_summary", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler("get_graph_summary", {}, actor, testGraph()) as {
      summary: string;
      currentState: string;
    };
    expect(result.summary).toContain("3 states");
    expect(result.currentState).toBe("Idle");
  });

  it("handles check_reachable", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler(
      "check_reachable",
      { targetState: "Done" },
      actor,
      testGraph(),
    ) as { reachable: boolean };
    expect(result.reachable).toBe(true);
  });

  it("returns unreachable for disconnected state", () => {
    const actor = mockActor("Done") as never;
    const result = llmToolHandler(
      "check_reachable",
      { targetState: "Idle" },
      actor,
      testGraph(),
    ) as { reachable: boolean };
    expect(result.reachable).toBe(false);
  });

  it("returns error when targetState is missing", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler("check_reachable", {}, actor, testGraph()) as { error: string };
    expect(result.error).toBe("targetState parameter is required and must be a string");
  });

  it("returns error when targetState is not a string", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler("check_reachable", { targetState: 42 }, actor, testGraph()) as {
      error: string;
    };
    expect(result.error).toBe("targetState parameter is required and must be a string");
  });

  it("returns error for unknown tool", () => {
    const actor = mockActor("Idle") as never;
    const result = llmToolHandler("unknown_tool", {}, actor, testGraph()) as { error: string };
    expect(result.error).toBe("Unknown tool: unknown_tool");
  });
});
