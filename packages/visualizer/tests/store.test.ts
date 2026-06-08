// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  $layout,
  $selectedNodeId,
  $zoom,
  $pan,
  $layoutError,
  $layoutLoading,
  setActor,
  selectNode,
  zoomIn,
  zoomOut,
  zoomToFit,
  resetView,
  setZoom,
  startActorSync,
} from "../src/graph-store.ts";
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
    $layout.set(null);
    $selectedNodeId.set(null);
    $zoom.set(1);
    $pan.set({ x: 0, y: 0 });
    $layoutError.set(null);
    $layoutLoading.set(false);
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

  it("starts with layoutLoading false", () => {
    expect($layoutLoading.get()).toBe(false);
  });

  it("setActor sets layoutLoading during computation", async () => {
    let loadingDuringCompute = false;
    const unsub = $layoutLoading.subscribe((v) => {
      if (v) loadingDuringCompute = true;
    });
    const actor = createTestActor();
    await setActor(actor);
    expect(loadingDuringCompute).toBe(true);
    expect($layoutLoading.get()).toBe(false);
    unsub();
  });

  it("setActor resets layoutLoading after completion", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($layoutLoading.get()).toBe(false);
  });

  it("setActor populates layout", async () => {
    const actor = createTestActor();
    await setActor(actor);

    expect($layout.get()).not.toBeNull();
    expect($layoutError.get()).toBeNull();
  });

  it("setZoom increases zoom", () => {
    $zoom.set(1);
    setZoom(1.2);
    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("setZoom decreases zoom", () => {
    $zoom.set(1);
    setZoom(0.8);
    expect($zoom.get()).toBeLessThan(1);
  });

  it("setZoom does not exceed max", () => {
    $zoom.set(5);
    setZoom(6);
    expect($zoom.get()).toBe(5);
  });

  it("setZoom does not go below min", () => {
    $zoom.set(0.1);
    setZoom(0.05);
    expect($zoom.get()).toBe(0.1);
  });

  it("zoomToFit resets when no layout", () => {
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

  it("setActor clears selectedNodeId", async () => {
    $selectedNodeId.set("idle");
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
    expect($layout.get()).not.toBeNull();
  });

  it("setActor clears error on success", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($layoutError.get()).toBeNull();
  });

  it("rapid setActor calls use latest result", async () => {
    const actor1 = createTestActor();
    const actor2 = createTestActor();

    const p1 = setActor(actor1);
    const p2 = setActor(actor2);
    await Promise.all([p1, p2]);

    expect($layoutError.get()).toBeNull();
  });

  it("selectNode sets selected node id", () => {
    selectNode("idle");
    expect($selectedNodeId.get()).toBe("idle");
  });

  it("selectNode clears selected node id with null", () => {
    $selectedNodeId.set("active");
    selectNode(null);
    expect($selectedNodeId.get()).toBeNull();
  });

  it("selectNode changes selection", () => {
    selectNode("idle");
    selectNode("active");
    expect($selectedNodeId.get()).toBe("active");
  });

  it("zoomIn increases zoom by 0.2", () => {
    $zoom.set(1);
    zoomIn();
    expect($zoom.get()).toBeCloseTo(1.2);
  });

  it("zoomIn does not exceed max zoom", () => {
    $zoom.set(4.9);
    zoomIn();
    expect($zoom.get()).toBe(5);
  });

  it("zoomOut decreases zoom by 0.2", () => {
    $zoom.set(1);
    zoomOut();
    expect($zoom.get()).toBeCloseTo(0.8);
  });

  it("zoomOut does not go below min zoom", () => {
    $zoom.set(0.2);
    zoomOut();
    expect($zoom.get()).toBe(0.1);
  });

  it("startActorSync returns unsubscribe function", () => {
    const unsub = startActorSync();
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
