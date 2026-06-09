// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  $layout,
  $layoutError,
  $errorStore,
  setActor,
  addError,
  clearErrors,
  removeError,
} from "../src/graph-store.ts";
import { computeLayout } from "../src/layout.ts";
import { buildGraph } from "../src/graph.ts";
import { Actor, state, event } from "@mantaq/core";

function createTestActor() {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    effects: {},
    transitions: {
      idle: { GO: () => ({ state: active }) },
    },
  });
}

describe("error store", () => {
  beforeEach(() => {
    $errorStore.set([]);
    $layoutError.set(null);
  });

  it("addError adds entry to store", () => {
    addError("test error", "test-source");
    const errors = $errorStore.get();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("test error");
    expect(errors[0].source).toBe("test-source");
    expect(errors[0].severity).toBe("error");
  });

  it("addError supports warn severity", () => {
    addError("warn msg", "src", "warn");
    expect($errorStore.get()[0].severity).toBe("warn");
  });

  it("addError supports info severity", () => {
    addError("info msg", "src", "info");
    expect($errorStore.get()[0].severity).toBe("info");
  });

  it("addError increments id", () => {
    addError("first", "src");
    addError("second", "src");
    const errors = $errorStore.get();
    expect(errors[0].id).not.toBe(errors[1].id);
  });

  it("clearErrors removes all entries", () => {
    addError("a", "src");
    addError("b", "src");
    clearErrors();
    expect($errorStore.get()).toEqual([]);
  });

  it("removeError removes specific entry", () => {
    addError("a", "src");
    addError("b", "src");
    const id = $errorStore.get()[0].id;
    removeError(id);
    expect($errorStore.get().length).toBe(1);
    expect($errorStore.get()[0].message).toBe("b");
  });

  it("addError includes timestamp", () => {
    const before = Date.now();
    addError("test", "src");
    const after = Date.now();
    const entry = $errorStore.get()[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("layout error handling", () => {
  beforeEach(() => {
    $layout.set(null);
    $layoutError.set(null);
  });

  it("computeLayout throws for null graph", async () => {
    await expect(computeLayout(null as never)).rejects.toThrow("null or undefined");
  });

  it("computeLayout throws for invalid nodes", async () => {
    await expect(computeLayout({ nodes: "bad" as never, edges: [] })).rejects.toThrow(
      "not an array",
    );
  });

  it("computeLayout throws for invalid edges", async () => {
    await expect(computeLayout({ nodes: [], edges: "bad" as never })).rejects.toThrow(
      "not an array",
    );
  });

  it("computeLayout returns empty for empty graph", async () => {
    const result = await computeLayout({ nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it("computeLayout handles single-node graph", async () => {
    const result = await computeLayout({
      nodes: [{ id: "a", label: "A", isActive: true, isFinal: false }],
      edges: [],
    });
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("a");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("computeLayout handles single-node with self-loop", async () => {
    const result = await computeLayout({
      nodes: [{ id: "a", label: "A", isActive: true, isFinal: false }],
      edges: [{ id: "a-a", source: "a", target: "a", label: "PING", isActive: false }],
    });
    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].path).toContain("C");
  });

  it("setActor sets layoutError on failure", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($layoutError.get()).toBeNull();
  });

  it("setActor clears layoutError on success", async () => {
    $layoutError.set("previous error");
    const actor = createTestActor();
    await setActor(actor);
    expect($layoutError.get()).toBeNull();
  });
});

describe("graph building error handling", () => {
  it("buildGraph returns empty for null actor", () => {
    const result = buildGraph(null as never);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("buildGraph handles actor with no states", () => {
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [],
      initial: undefined as never,
      context: {} as {},
      effects: {},
      transitions: {},
    });
    const result = buildGraph(actor);
    expect(result.nodes).toEqual([]);
  });

  it("buildGraph handles actor with no transitions", () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {},
    });
    const result = buildGraph(actor);
    expect(result.nodes.length).toBe(1);
    expect(result.edges).toEqual([]);
  });
});
