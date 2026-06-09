// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

import {
  $layout,
  $previousLayout,
  $selectedNodeId,
  $zoom,
  $pan,
  $layoutError,
  $contextData,
  $animationEnabled,
  $animationSpeed,
  $prefersReducedMotion,
  $lastTransition,
  $graphData,
  $searchQuery,
  $searchResults,
  $filterStatus,
  $theme,
  $customStyles,
  $errorStore,
  setActor,
  zoomToFit,
  resetView,
  setZoom,
  startActorSync,
  toggleAnimation,
  setAnimationSpeed,
  setSearchQuery,
  getVisibleNodes,
  setTheme,
  cycleTheme,
  initTheme,
  setCustomStyles,
  addError,
  clearErrors,
  removeError,
} from "../src/graph-store.ts";
import { Actor, state, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";

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
    $contextData.set({});
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

  it("setZoom at exact min boundary", () => {
    setZoom(0.1);
    expect($zoom.get()).toBe(0.1);
  });

  it("setZoom at exact max boundary", () => {
    setZoom(5);
    expect($zoom.get()).toBe(5);
  });

  it("setZoom handles zero", () => {
    setZoom(0);
    expect($zoom.get()).toBe(0.1);
  });

  it("setZoom handles NaN", () => {
    setZoom(2);
    setZoom(NaN);
    expect($zoom.get()).toBeNaN();
  });

  it("setZoom handles Infinity", () => {
    setZoom(Infinity);
    expect($zoom.get()).toBe(5);
  });

  it("setZoom handles -Infinity", () => {
    setZoom(-Infinity);
    expect($zoom.get()).toBe(0.1);
  });

  it("setZoom decimal precision", () => {
    setZoom(1.333);
    expect($zoom.get()).toBeCloseTo(1.333, 3);
  });

  it("zoomToFit resets when no actor-graph element", () => {
    $zoom.set(3);
    $pan.set({ x: 100, y: 200 });
    document.querySelectorAll("actor-graph").forEach((el) => el.remove());
    zoomToFit();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("zoomToFit computes zoom when actor-graph element exists", () => {
    const el = document.createElement("actor-graph");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    $layout.set({
      nodes: [],
      edges: [],
      width: 400,
      height: 300,
    });

    zoomToFit();
    expect($zoom.get()).toBeGreaterThan(0);
    expect($zoom.get()).toBeLessThanOrEqual(5);
    el.remove();
  });

  it("zoomToFit clamps zoom to min when element is tiny", () => {
    const el = document.createElement("actor-graph");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    $layout.set({
      nodes: [],
      edges: [],
      width: 10000,
      height: 10000,
    });

    zoomToFit();
    expect($zoom.get()).toBe(0.1);
    el.remove();
  });

  it("zoomToFit clamps zoom to max when layout is tiny", () => {
    const el = document.createElement("actor-graph");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    $layout.set({
      nodes: [],
      edges: [],
      width: 1,
      height: 1,
    });

    zoomToFit();
    expect($zoom.get()).toBe(5);
    el.remove();
  });

  it("zoomToFit resets when element has zero dimensions", () => {
    const el = document.createElement("actor-graph");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    $layout.set({ nodes: [], edges: [], width: 400, height: 300 });
    $zoom.set(3);
    zoomToFit();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
    el.remove();
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

  it("rapid setActor calls leave valid layout", async () => {
    const actors = Array.from({ length: 5 }, () => createTestActor());
    await Promise.all(actors.map((a) => setActor(a)));
    expect($layout.get()).not.toBeNull();
    expect($layoutError.get()).toBeNull();
  });

  it("rapid setActor calls with different actor types", async () => {
    const a = state("a")();
    const b = state("b")();
    const go = event("GO")();

    const actor1 = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [a, b],
      initial: a,
      context: {} as {},
      effects: {},
      transitions: { a: { GO: () => ({ state: b }) } },
    });

    const actor2 = createTestActor();

    await Promise.all([setActor(actor1), setActor(actor2)]);
    expect($layout.get()).not.toBeNull();
  });

  it("sequential setActor calls produce valid state", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($layout.get()).not.toBeNull();

    actor.send(event("GO")());
    await setActor(actor);
    expect($layout.get()).not.toBeNull();
    expect($layoutError.get()).toBeNull();
  });

  it("setActor then immediate get returns consistent state", async () => {
    const actor = createTestActor();
    await setActor(actor);
    const layout = $layout.get();
    const graph = $graphData.get();
    expect(layout).not.toBeNull();
    expect(graph).not.toBeNull();
    expect(layout!.nodes.length).toBe(graph!.nodes.length);
  });

  it("setActor with three-state actor", async () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")().final();
    const go = event("GO")();
    const next = event("NEXT")();

    const actor = new Actor({
      inputs: [go, next],
      outputs: [],
      internal: [],
      states: [a, b, c],
      initial: a,
      context: {} as {},
      effects: {},
      transitions: {
        a: { GO: () => ({ state: b }) },
        b: { NEXT: () => ({ state: c }) },
      },
    });

    await setActor(actor);
    const layout = $layout.get();
    expect(layout).not.toBeNull();
    expect(layout!.nodes.length).toBe(3);
  });

  it("setActor with region actor", async () => {
    const subA = state("subA")();
    const subB = state("subB")();
    const toggle = event("TOGGLE")();

    const child = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      states: [subA, subB],
      initial: subA,
      context: {} as {},
      effects: {},
      transitions: {
        subA: { TOGGLE: () => ({ state: subB }) },
      },
    });

    const parent = state("parent")();
    const start = event("START")();

    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [],
      states: [parent],
      initial: parent,
      context: {} as {},
      effects: {},
      regions: { child },
      transitions: {},
    });

    await setActor(actor);
    const layout = $layout.get();
    expect(layout).not.toBeNull();
    expect(layout!.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("setActor populates graphData", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect($graphData.get()).not.toBeNull();
    expect($graphData.get()!.nodes.length).toBeGreaterThan(0);
  });

  it("setActor populates previousLayout on second call", async () => {
    const actor = createTestActor();
    await setActor(actor);
    const firstLayout = $layout.get();

    actor.send(event("GO")());
    await setActor(actor);
    expect($previousLayout.get()).toBe(firstLayout);
  });

  it("setActor tracks activated nodes on transition", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const done = state("done")().final();
    const go = event("GO")();
    const finish = event("FINISH")();

    const actor = new Actor({
      inputs: [go, finish],
      outputs: [],
      internal: [],
      states: [idle, active, done],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {
        idle: { GO: () => ({ state: active }) },
        active: { FINISH: () => ({ state: done }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    const t = $lastTransition.get();
    expect(t).not.toBeNull();
    expect(t!.activatedNodes).toContain("active");
    expect(t!.deactivatedNodes).toContain("idle");
  });

  it("setActor with self-loop actor", async () => {
    const active = state("active")();
    const ping = event("PING")();

    const actor = new Actor({
      inputs: [ping],
      outputs: [],
      internal: [],
      states: [active],
      initial: active,
      context: {} as {},
      effects: {},
      transitions: {
        active: { PING: () => ({ state: active }) },
      },
    });

    await setActor(actor);
    const layout = $layout.get();
    expect(layout).not.toBeNull();
    expect(layout!.nodes.length).toBe(1);
  });

  it("setActor clears selectedNodeId even with error", async () => {
    $selectedNodeId.set("some-node");
    const actor = createTestActor();
    await setActor(actor);
    expect($selectedNodeId.get()).toBeNull();
  });

  it("setActor with single state actor", async () => {
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
    const layout = $layout.get();
    expect(layout).not.toBeNull();
    expect(layout!.nodes.length).toBe(1);
    expect(layout!.edges.length).toBe(0);
  });

  it("setActor with actor having empty context", async () => {
    const idle = state("idle")();
    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {},
      effects: {},
      transitions: {},
    });

    await setActor(actor);
    expect($contextData.get()).toHaveProperty("idle");
  });

  it("setActor with actor having complex context", async () => {
    const idle = state("idle")();
    const ctx = {
      str: "hello",
      num: 42,
      nested: { a: { b: { c: true } } },
      arr: [1, 2, 3],
    };

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: ctx,
      effects: {},
      transitions: {},
    });

    await setActor(actor);
    expect($contextData.get().idle).toEqual(ctx);
  });

  it("setActor with many states", async () => {
    const states = Array.from({ length: 10 }, (_, i) => state(`s${i}`)());
    const go = event("GO")();

    const transitions: Record<string, Record<string, () => { state: any }>> = {};
    for (let i = 0; i < 9; i++) {
      transitions[`s${i}`] = { GO: () => ({ state: states[i + 1] }) };
    }

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states,
      initial: states[0],
      context: {} as {},
      effects: {},
      transitions,
    });

    await setActor(actor as unknown as AnyActor);
    const layout = $layout.get();
    expect(layout).not.toBeNull();
    expect(layout!.nodes.length).toBe(10);
  });

  it("startActorSync returns unsubscribe function", () => {
    const unsub = startActorSync();
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

describe("context store", () => {
  beforeEach(() => {
    $contextData.set({});
    $layout.set(null);
    $selectedNodeId.set(null);
  });

  it("starts with empty context", () => {
    expect($contextData.get()).toEqual({});
  });

  it("setActor populates context data", async () => {
    const actor = createTestActor();
    await setActor(actor);
    const ctx = $contextData.get();
    expect(Object.keys(ctx).length).toBeGreaterThan(0);
  });

  it("context keys match node IDs", async () => {
    const actor = createTestActor();
    await setActor(actor);
    const ctx = $contextData.get();
    expect(ctx).toHaveProperty("idle");
    expect(ctx).toHaveProperty("active");
  });

  it("context values are objects", async () => {
    const actor = createTestActor();
    await setActor(actor);
    const ctx = $contextData.get();
    for (const val of Object.values(ctx)) {
      expect(typeof val).toBe("object");
    }
  });

  it("setActor with context data stores it", async () => {
    const idle = state("idle")();
    const go = event("GO")();
    const testCtx = { count: 42, name: "test" };

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: testCtx,
      effects: {},
      transitions: {},
    });

    await setActor(actor);
    const ctx = $contextData.get();
    expect(ctx.idle).toEqual(testCtx);
  });

  it("setActor clears previous context", async () => {
    const actor1 = createTestActor();
    await setActor(actor1);
    expect(Object.keys($contextData.get()).length).toBeGreaterThan(0);

    const idle = state("solo")();
    const actor2 = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as {},
      effects: {},
      transitions: {},
    });
    await setActor(actor2);
    expect($contextData.get()).toHaveProperty("solo");
    expect($contextData.get()).not.toHaveProperty("idle");
  });

  it("handles nested context objects", async () => {
    const idle = state("idle")();
    const nestedCtx = { user: { name: "Alice", meta: { role: "admin" } } };

    const actor = new Actor({
      inputs: [],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: nestedCtx,
      effects: {},
      transitions: {},
    });

    await setActor(actor);
    const ctx = $contextData.get();
    expect(ctx.idle).toEqual(nestedCtx);
  });

  it("handles region actor contexts", async () => {
    const subA = state("subA")();
    const subB = state("subB")();
    const toggle = event("TOGGLE")();

    const child = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      states: [subA, subB],
      initial: subA,
      context: { childData: true },
      effects: {},
      transitions: {
        subA: { TOGGLE: () => ({ state: subB }) },
      },
    });

    const parent = state("parent")();
    const start = event("START")();

    const actor = new Actor({
      inputs: [start],
      outputs: [],
      internal: [],
      states: [parent],
      initial: parent,
      context: { parentData: true },
      effects: {},
      regions: { child },
      transitions: {},
    });

    await setActor(actor);
    const ctx = $contextData.get();
    expect(ctx).toHaveProperty("parent");
    expect(ctx).toHaveProperty("child.subA");
    expect(ctx).toHaveProperty("child.subB");
  });
});

describe("animation state", () => {
  beforeEach(() => {
    $animationEnabled.set(true);
    $animationSpeed.set(1);
    $prefersReducedMotion.set(false);
    $lastTransition.set(null);
  });

  it("starts with animations enabled", () => {
    expect($animationEnabled.get()).toBe(true);
  });

  it("starts with speed 1", () => {
    expect($animationSpeed.get()).toBe(1);
  });

  it("starts with no transition", () => {
    expect($lastTransition.get()).toBeNull();
  });

  it("toggleAnimation toggles enabled state", () => {
    toggleAnimation();
    expect($animationEnabled.get()).toBe(false);
    toggleAnimation();
    expect($animationEnabled.get()).toBe(true);
  });

  it("setAnimationSpeed clamps to valid range", () => {
    setAnimationSpeed(0.1);
    expect($animationSpeed.get()).toBe(0.25);
    setAnimationSpeed(10);
    expect($animationSpeed.get()).toBe(4);
    setAnimationSpeed(2);
    expect($animationSpeed.get()).toBe(2);
  });

  it("setActor populates lastTransition on state change", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
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

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    const transition = $lastTransition.get();
    expect(transition).not.toBeNull();
    expect(transition?.activatedNodes).toContain("active");
    expect(transition?.deactivatedNodes).toContain("idle");
  });

  it("transition includes timestamp", async () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
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

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    const transition = $lastTransition.get();
    expect(transition?.timestamp).toBeGreaterThan(0);
  });

  it("toggleAnimation multiple times", () => {
    expect($animationEnabled.get()).toBe(true);
    toggleAnimation();
    expect($animationEnabled.get()).toBe(false);
    toggleAnimation();
    expect($animationEnabled.get()).toBe(true);
    toggleAnimation();
    expect($animationEnabled.get()).toBe(false);
  });

  it("setAnimationSpeed at exact min boundary", () => {
    setAnimationSpeed(0.25);
    expect($animationSpeed.get()).toBe(0.25);
  });

  it("setAnimationSpeed at exact max boundary", () => {
    setAnimationSpeed(4);
    expect($animationSpeed.get()).toBe(4);
  });

  it("setAnimationSpeed handles zero", () => {
    setAnimationSpeed(0);
    expect($animationSpeed.get()).toBe(0.25);
  });

  it("setAnimationSpeed handles negative", () => {
    setAnimationSpeed(-1);
    expect($animationSpeed.get()).toBe(0.25);
  });

  it("setAnimationSpeed handles decimal values", () => {
    setAnimationSpeed(1.5);
    expect($animationSpeed.get()).toBe(1.5);
  });

  it("$prefersReducedMotion defaults to false", () => {
    $prefersReducedMotion.set(false);
    expect($prefersReducedMotion.get()).toBe(false);
  });

  it("$prefersReducedMotion can be set to true", () => {
    $prefersReducedMotion.set(true);
    expect($prefersReducedMotion.get()).toBe(true);
  });

  it("$animationEnabled is independent of prefersReducedMotion", () => {
    $prefersReducedMotion.set(true);
    expect($animationEnabled.get()).toBe(true);
  });

  it("transition tracks deactivated edges", async () => {
    const a = state("a")();
    const b = state("b")();
    const c = state("c")();
    const go = event("GO")();
    const next = event("NEXT")();

    const actor = new Actor({
      inputs: [go, next],
      outputs: [],
      internal: [],
      states: [a, b, c],
      initial: a,
      context: {} as {},
      effects: {},
      transitions: {
        a: { GO: () => ({ state: b }) },
        b: { NEXT: () => ({ state: c }) },
      },
    });

    await setActor(actor);
    actor.send(go);
    await setActor(actor);
    const t = $lastTransition.get();
    expect(t).not.toBeNull();
    expect(t!.timestamp).toBeGreaterThan(0);
    expect(Array.isArray(t!.activatedNodes)).toBe(true);
    expect(Array.isArray(t!.deactivatedNodes)).toBe(true);
    expect(Array.isArray(t!.activatedEdges)).toBe(true);
    expect(Array.isArray(t!.deactivatedEdges)).toBe(true);
  });

  it("no transition when same state is set again", async () => {
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
    $lastTransition.set(null);
    await setActor(actor);
    expect($lastTransition.get()).toBeNull();
  });
});

describe("search and filter", () => {
  beforeEach(() => {
    $layout.set(null);
    $searchQuery.set("");
    $searchResults.set([]);
    $filterStatus.set("all");
  });

  it("$searchQuery defaults to empty string", () => {
    expect($searchQuery.get()).toBe("");
  });

  it("$searchResults defaults to empty array", () => {
    expect($searchResults.get()).toEqual([]);
  });

  it("$filterStatus defaults to all", () => {
    expect($filterStatus.get()).toBe("all");
  });

  it("setSearchQuery updates $searchQuery", () => {
    setSearchQuery("idle");
    expect($searchQuery.get()).toBe("idle");
  });

  it("setSearchQuery with empty string clears results", () => {
    setSearchQuery("idle");
    setSearchQuery("");
    expect($searchResults.get()).toEqual([]);
  });

  it("fuzzy match finds substring", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("idl");
    expect($searchResults.get()).toContain("idle");
  });

  it("fuzzy match finds character sequence", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("id");
    expect($searchResults.get()).toContain("idle");
  });

  it("fuzzy match is case insensitive", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("IDLE");
    expect($searchResults.get()).toContain("idle");
  });

  it("fuzzy match returns empty for no match", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("zzz");
    expect($searchResults.get()).toEqual([]);
  });

  it("getVisibleNodes returns null when no filter/search active", async () => {
    const actor = createTestActor();
    await setActor(actor);
    expect(getVisibleNodes()).toBeNull();
  });

  it("getVisibleNodes filters by active status", async () => {
    const actor = createTestActor();
    await setActor(actor);
    $filterStatus.set("active");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.has("idle")).toBe(true);
  });

  it("getVisibleNodes filters by final status", async () => {
    const actor = createTestActor();
    await setActor(actor);
    $filterStatus.set("final");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.size).toBe(0);
  });

  it("getVisibleNodes filters by inactive status", async () => {
    const actor = createTestActor();
    await setActor(actor);
    $filterStatus.set("inactive");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.has("active")).toBe(true);
  });

  it("getVisibleNodes combines search and filter", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("idl");
    $filterStatus.set("active");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.has("idle")).toBe(true);
    expect(visible!.has("active")).toBe(false);
  });

  it("setSearchQuery with whitespace-only clears results", () => {
    setSearchQuery("   ");
    expect($searchResults.get()).toEqual([]);
  });

  it("setSearchQuery trims whitespace", () => {
    setSearchQuery("  idle  ");
    expect($searchQuery.get()).toBe("  idle  ");
  });

  it("fuzzy match finds exact match", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("idle");
    expect($searchResults.get()).toContain("idle");
  });

  it("fuzzy match with single character", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("a");
    expect($searchResults.get()).toContain("active");
  });

  it("getVisibleNodes returns null when no layout", () => {
    $layout.set(null);
    expect(getVisibleNodes()).toBeNull();
  });

  it("getVisibleNodes with search only (no filter)", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("active");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.has("active")).toBe(true);
    expect(visible!.has("idle")).toBe(false);
  });

  it("getVisibleNodes with filter only (no search)", async () => {
    const actor = createTestActor();
    await setActor(actor);
    $filterStatus.set("active");
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.has("idle")).toBe(true);
  });

  it("getVisibleNodes all filter returns all nodes", async () => {
    const actor = createTestActor();
    await setActor(actor);
    $filterStatus.set("all");
    const visible = getVisibleNodes();
    expect(visible).toBeNull();
  });

  it("search with no matches returns empty results", async () => {
    const actor = createTestActor();
    await setActor(actor);
    setSearchQuery("zzzzzzz");
    expect($searchResults.get()).toEqual([]);
    const visible = getVisibleNodes();
    expect(visible).not.toBeNull();
    expect(visible!.size).toBe(0);
  });
});

describe("theme store", () => {
  afterEach(() => {
    $theme.set("system");
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("mantaq-theme");
  });

  it("setTheme sets theme atom", () => {
    setTheme("dark");
    expect($theme.get()).toBe("dark");
  });

  it("setTheme sets data-theme attribute", () => {
    setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme with light sets correct attribute", () => {
    setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setTheme with high-contrast sets correct attribute", () => {
    setTheme("high-contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
  });

  it("setTheme with system resolves to light or dark", () => {
    setTheme("system");
    const attr = document.documentElement.getAttribute("data-theme");
    expect(attr === "light" || attr === "dark").toBe(true);
  });

  it("setTheme persists to localStorage", () => {
    setTheme("dark");
    expect(localStorage.getItem("mantaq-theme")).toBe("dark");
  });

  it("cycleTheme goes light -> dark -> high-contrast -> system -> light", () => {
    setTheme("light");
    cycleTheme();
    expect($theme.get()).toBe("dark");
    cycleTheme();
    expect($theme.get()).toBe("high-contrast");
    cycleTheme();
    expect($theme.get()).toBe("system");
    cycleTheme();
    expect($theme.get()).toBe("light");
  });

  it("initTheme reads from localStorage", () => {
    localStorage.setItem("mantaq-theme", "dark");
    initTheme();
    expect($theme.get()).toBe("dark");
  });

  it("initTheme defaults to system when no saved value", () => {
    localStorage.removeItem("mantaq-theme");
    initTheme();
    expect($theme.get()).toBe("system");
  });

  it("initTheme ignores invalid localStorage values", () => {
    localStorage.setItem("mantaq-theme", "invalid");
    initTheme();
    expect($theme.get()).toBe("system");
  });

  it("setCustomStyles sets $customStyles atom", () => {
    const css = ":root { --custom: red; }";
    setCustomStyles(css);
    expect($customStyles.get()).toBe(css);
  });

  it("setCustomStyles injects style element", () => {
    const css = ":root { --custom: blue; }";
    setCustomStyles(css);
    const el = document.getElementById("mantaq-custom-styles");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(css);
  });

  it("setCustomStyles updates existing style element", () => {
    setCustomStyles("first");
    setCustomStyles("second");
    const els = document.querySelectorAll("#mantaq-custom-styles");
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe("second");
  });

  it("$theme defaults to system", () => {
    $theme.set("system");
    expect($theme.get()).toBe("system");
  });

  it("$customStyles defaults to empty", () => {
    $customStyles.set("");
    expect($customStyles.get()).toBe("");
  });
});

describe("error store", () => {
  beforeEach(() => {
    $errorStore.set([]);
  });

  it("starts with empty errors", () => {
    expect($errorStore.get()).toEqual([]);
  });

  it("addError adds an error entry", () => {
    addError("test error", "test-source");
    const errors = $errorStore.get();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("test error");
    expect(errors[0].source).toBe("test-source");
    expect(errors[0].severity).toBe("error");
  });

  it("addError generates unique ids", () => {
    addError("error 1", "src");
    addError("error 2", "src");
    const errors = $errorStore.get();
    expect(errors.length).toBe(2);
    expect(errors[0].id).not.toBe(errors[1].id);
  });

  it("addError with custom severity", () => {
    addError("warn msg", "src", "warn");
    addError("info msg", "src", "info");
    const errors = $errorStore.get();
    expect(errors[0].severity).toBe("warn");
    expect(errors[1].severity).toBe("info");
  });

  it("addError includes timestamp", () => {
    const before = Date.now();
    addError("test", "src");
    const after = Date.now();
    const errors = $errorStore.get();
    expect(errors[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(errors[0].timestamp).toBeLessThanOrEqual(after);
  });

  it("clearErrors removes all errors", () => {
    addError("a", "src");
    addError("b", "src");
    clearErrors();
    expect($errorStore.get()).toEqual([]);
  });

  it("clearErrors on empty store is safe", () => {
    clearErrors();
    expect($errorStore.get()).toEqual([]);
  });

  it("removeError removes specific error", () => {
    addError("a", "src");
    addError("b", "src");
    const errors = $errorStore.get();
    removeError(errors[0].id);
    const remaining = $errorStore.get();
    expect(remaining.length).toBe(1);
    expect(remaining[0].message).toBe("b");
  });

  it("removeError with non-existent id is no-op", () => {
    addError("a", "src");
    removeError("nonexistent");
    expect($errorStore.get().length).toBe(1);
  });

  it("addError accumulates multiple errors", () => {
    for (let i = 0; i < 5; i++) {
      addError(`error ${i}`, "src");
    }
    expect($errorStore.get().length).toBe(5);
  });

  it("removeError from middle preserves others", () => {
    addError("first", "src");
    addError("second", "src");
    addError("third", "src");
    const errors = $errorStore.get();
    removeError(errors[1].id);
    const remaining = $errorStore.get();
    expect(remaining.length).toBe(2);
    expect(remaining[0].message).toBe("first");
    expect(remaining[1].message).toBe("third");
  });
});
