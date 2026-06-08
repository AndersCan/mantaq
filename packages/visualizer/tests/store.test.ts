import { describe, it, expect, beforeEach } from "vite-plus/test";
import { state, event, Actor } from "@mantaq/core";
import {
  $actor,
  $graph,
  $layout,
  $layoutLoading,
  $layoutError,
  $selectedNodeId,
  $zoom,
  $pan,
  $viewport,
  $flatNodes,
  $edges,
  $selectedNode,
  $graphDimensions,
  setActor,
  selectNode,
  zoomIn,
  zoomOut,
  resetView,
  setViewport,
  startActorSync,
} from "../src/stores/graph-store.ts";

function createTestActor() {
  const idle = state("idle")();
  const active = state("active")();
  const TOGGLE = event("TOGGLE")();

  return new Actor({
    inputs: [TOGGLE],
    states: [idle, active],
    initial: idle,
    transitions: {
      idle: { TOGGLE: () => ({ state: active }) },
      active: { TOGGLE: () => ({ state: idle }) },
    },
  });
}

describe("graph store", () => {
  beforeEach(() => {
    $actor.set(null);
    $layout.set(null);
    $selectedNodeId.set(null);
    $zoom.set(1);
    $pan.set({ x: 0, y: 0 });
    $viewport.set({ width: 800, height: 600 });
  });

  it("initializes with null state", () => {
    expect($actor.get()).toBeNull();
    expect($graph.get()).toBeNull();
    expect($layout.get()).toBeNull();
    expect($layoutLoading.get()).toBe(false);
    expect($layoutError.get()).toBeNull();
    expect($selectedNodeId.get()).toBeNull();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("setActor builds graph and layout", async () => {
    const actor = createTestActor();
    setActor(actor);

    await new Promise((r) => setTimeout(r, 50));

    expect($actor.get()).toBe(actor);
    expect($graph.get()).not.toBeNull();
    expect($layout.get()).not.toBeNull();
    expect($graph.get()!.nodes).toHaveLength(2);
  });

  it("setActor(null) clears state", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    setActor(null);
    expect($graph.get()).toBeNull();
    expect($layout.get()).toBeNull();
    expect($selectedNodeId.get()).toBeNull();
  });

  it("selectNode updates selectedNodeId", () => {
    selectNode("idle");
    expect($selectedNodeId.get()).toBe("idle");

    selectNode(null);
    expect($selectedNodeId.get()).toBeNull();
  });

  it("$selectedNode returns correct node", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    selectNode("idle");
    const node = $selectedNode.get();
    expect(node).not.toBeNull();
    expect(node!.id).toBe("idle");
  });

  it("$selectedNode returns null when nothing selected", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    expect($selectedNode.get()).toBeNull();
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

  it("zoomIn respects max bound", () => {
    $zoom.set(4.9);
    zoomIn();
    expect($zoom.get()).toBeLessThanOrEqual(5);
  });

  it("zoomOut respects min bound", () => {
    $zoom.set(0.15);
    zoomOut();
    expect($zoom.get()).toBeGreaterThanOrEqual(0.1);
  });

  it("resetView resets zoom and pan", () => {
    $zoom.set(2);
    $pan.set({ x: 100, y: 100 });
    resetView();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("setViewport updates viewport", () => {
    setViewport(1024, 768);
    expect($viewport.get()).toEqual({ width: 1024, height: 768 });
  });

  it("$flatNodes returns layout nodes", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    expect($flatNodes.get().length).toBeGreaterThan(0);
  });

  it("$edges returns layout edges", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    expect($edges.get().length).toBeGreaterThan(0);
  });

  it("$graphDimensions returns layout dimensions", async () => {
    const actor = createTestActor();
    setActor(actor);
    await new Promise((r) => setTimeout(r, 50));

    const dims = $graphDimensions.get();
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  it("$graphDimensions returns defaults when no layout", () => {
    const dims = $graphDimensions.get();
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it("startActorSync returns unsubscribe function", () => {
    const unsub = startActorSync();
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("startActorSync updates graph when actor changes", async () => {
    const actor = createTestActor();
    const unsub = startActorSync();

    $actor.set(actor);
    await new Promise((r) => setTimeout(r, 50));

    expect($graph.get()).not.toBeNull();
    expect($graph.get()!.nodes).toHaveLength(2);

    unsub();
  });

  it("startActorSync clears graph when actor set to null", async () => {
    const unsub = startActorSync();
    const actor = createTestActor();
    $actor.set(actor);
    await new Promise((r) => setTimeout(r, 50));

    expect($graph.get()).not.toBeNull();

    $actor.set(null);
    await new Promise((r) => setTimeout(r, 10));

    expect($graph.get()).toBeNull();
    unsub();
  });

  it("setActor rebuilds graph on re-assignment", async () => {
    const actor1 = createTestActor();
    setActor(actor1);
    await new Promise((r) => setTimeout(r, 50));

    const graph1 = $graph.get();
    expect(graph1).not.toBeNull();

    setActor(actor1);
    await new Promise((r) => setTimeout(r, 50));

    const graph2 = $graph.get();
    expect(graph2).not.toBeNull();
    expect(graph2!.nodes).toHaveLength(2);
  });
});
