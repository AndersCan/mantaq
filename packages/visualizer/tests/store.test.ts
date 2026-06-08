import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  $actor,
  $graph,
  $layout,
  $selectedNodeId,
  $zoom,
  $pan,
  $layoutError,
  $isComputing,
  setActor,
  selectNode,
  zoomIn,
  zoomOut,
  zoomToFit,
  resetView,
  setZoom,
  setPan,
} from "../src/stores/graph-store.ts";
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

describe("graph store", () => {
  beforeEach(() => {
    $actor.set(null);
    $graph.set(null);
    $layout.set(null);
    $selectedNodeId.set(null);
    $zoom.set(1);
    $pan.set({ x: 0, y: 0 });
    $layoutError.set(null);
    $isComputing.set(false);
  });

  it("starts with null actor", () => {
    expect($actor.get()).toBeNull();
  });

  it("starts with null graph", () => {
    expect($graph.get()).toBeNull();
  });

  it("starts with null layout", () => {
    expect($layout.get()).toBeNull();
  });

  it("starts with zoom 1", () => {
    expect($zoom.get()).toBe(1);
  });

  it("starts with zero pan", () => {
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("starts with no selected node", () => {
    expect($selectedNodeId.get()).toBeNull();
  });

  it("setActor populates graph and layout", async () => {
    const actor = createTestActor();
    await setActor(actor);

    expect($actor.get()).toBe(actor);
    expect($graph.get()).not.toBeNull();
    expect($layout.get()).not.toBeNull();
    expect($layoutError.get()).toBeNull();
  });

  it("setActor creates graph with correct nodes", async () => {
    const actor = createTestActor();
    await setActor(actor);

    const graph = $graph.get();
    expect(graph).not.toBeNull();
    expect(graph!.nodes.length).toBe(2);
    expect(graph!.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(["idle", "active"]));
  });

  it("setActor marks active state", async () => {
    const actor = createTestActor();
    await setActor(actor);

    const graph = $graph.get();
    const active = graph!.nodes.find((n) => n.isActive);
    expect(active!.label).toBe("idle");
  });

  it("selectNode updates selectedNodeId", () => {
    selectNode("idle");
    expect($selectedNodeId.get()).toBe("idle");
  });

  it("selectNode with null clears selection", () => {
    selectNode("idle");
    selectNode(null);
    expect($selectedNodeId.get()).toBeNull();
  });

  it("zoomIn increases zoom", () => {
    $zoom.set(1);
    zoomIn();
    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("zoomOut decreases zoom", () => {
    $zoom.set(1);
    zoomOut();
    expect($zoom.get()).toBeLessThan(1);
  });

  it("zoomIn does not exceed max", () => {
    $zoom.set(5);
    zoomIn();
    expect($zoom.get()).toBe(5);
  });

  it("zoomOut does not go below min", () => {
    $zoom.set(0.1);
    zoomOut();
    expect($zoom.get()).toBe(0.1);
  });

  it("zoomToFit resets zoom and pan", () => {
    $zoom.set(3);
    $pan.set({ x: 100, y: 200 });
    zoomToFit();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("resetView resets zoom and pan", () => {
    $zoom.set(2.5);
    $pan.set({ x: 50, y: 75 });
    resetView();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("setZoom clamps to min", () => {
    setZoom(-1);
    expect($zoom.get()).toBe(0.1);
  });

  it("setZoom clamps to max", () => {
    setZoom(100);
    expect($zoom.get()).toBe(5);
  });

  it("setZoom accepts valid values", () => {
    setZoom(2.5);
    expect($zoom.get()).toBe(2.5);
  });

  it("setPan updates pan values", () => {
    setPan({ x: 10, y: 20 });
    expect($pan.get()).toEqual({ x: 10, y: 20 });
  });

  it("setActor clears selectedNodeId", async () => {
    selectNode("idle");
    const actor = createTestActor();
    await setActor(actor);
    expect($selectedNodeId.get()).toBeNull();
  });

  it("setActor handles actor with no transitions", async () => {
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

    await setActor(actor);
    expect($graph.get()).not.toBeNull();
    expect($graph!.get()!.nodes.length).toBe(1);
  });

  it("setActor clears computing flag on error", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($isComputing.get()).toBe(false);
    expect($layoutError.get()).toBeNull();
  });

  it("rapid setActor calls use latest result", async () => {
    const actor1 = createTestActor();
    const actor2 = createTestActor();

    const p1 = setActor(actor1);
    const p2 = setActor(actor2);
    await Promise.all([p1, p2]);

    expect($isComputing.get()).toBe(false);
    expect($layoutError.get()).toBeNull();
  });
});
