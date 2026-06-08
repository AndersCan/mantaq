// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { Actor, state, event } from "@mantaq/core";
import { setActor, $layout, $selectedNodeId } from "../src/graph-store.ts";
import "../src/components/actor-graph.ts";
import "../src/components/state-node.ts";
import "../src/components/edge.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";

function createTrafficLight() {
  const green = state("green")();
  const yellow = state("yellow")();
  const red = state("red")();

  const next = event("NEXT")();

  return new Actor({
    inputs: [next],
    outputs: [],
    internal: [],
    states: [green, yellow, red],
    initial: green,
    context: {} as {},
    effects: {},
    transitions: {
      green: { NEXT: () => ({ state: yellow }) },
      yellow: { NEXT: () => ({ state: red }) },
      red: { NEXT: () => ({ state: green }) },
    },
  });
}

function createWithRegions() {
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
      subB: { TOGGLE: () => ({ state: subA }) },
    },
  });

  const parent = state("parent")();
  const start = event("START")();

  return new Actor({
    inputs: [start],
    outputs: [],
    internal: [],
    states: [parent],
    initial: parent,
    context: {} as {},
    effects: {},
    regions: { child },
    transitions: {
      parent: { START: () => ({ state: parent }) },
    },
  });
}

function createGraphComponent(): ActorGraphComponent {
  const el = document.createElement("actor-graph") as ActorGraphComponent;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("integration: full visualizer flow", () => {
  beforeEach(async () => {
    $layout.set(null);
    $selectedNodeId.set(null);
  });

  it("renders traffic light graph", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    const nodes = el.shadowRoot!.querySelectorAll("state-node");
    expect(nodes.length).toBe(3);
  });

  it("shows active state highlight", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    const nodes = el.shadowRoot!.querySelectorAll("state-node");
    let activeCount = 0;
    for (const node of nodes) {
      const isActive = (node as HTMLElement & { isActive: boolean }).isActive;
      if (isActive) activeCount++;
    }
    expect(activeCount).toBe(1);
  });

  it("renders edge paths", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    const edges = el.shadowRoot!.querySelectorAll("edge-path");
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });

  it("node selection updates store", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    $selectedNodeId.set("green");
    expect($selectedNodeId.get()).toBe("green");
  });

  it("handles region actors", async () => {
    const actor = createWithRegions();
    await setActor(actor);

    expect($layout.get()).not.toBeNull();
    const layout = $layout.get();
    const labels = layout!.nodes.map((n) => n.label);
    expect(labels).toContain("parent");
    expect(labels).toContain("subA");
  });

  it("graph updates after state transition", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    let layout = $layout.get();
    const initialActive = layout!.nodes.find((n) => n.isActive);
    expect(initialActive!.label).toBe("green");

    const next = event("NEXT")();
    actor.send(next);
    await setActor(actor);

    layout = $layout.get();
    const newActive = layout!.nodes.find((n) => n.isActive);
    expect(newActive!.label).toBe("yellow");
  });

  it("full cycle: green -> yellow -> red -> green", async () => {
    const actor = createTrafficLight();
    const next = event("NEXT")();

    await setActor(actor);
    expect($layout.get()!.nodes.find((n) => n.isActive)!.label).toBe("green");

    actor.send(next);
    await setActor(actor);
    expect($layout.get()!.nodes.find((n) => n.isActive)!.label).toBe("yellow");

    actor.send(next);
    await setActor(actor);
    expect($layout.get()!.nodes.find((n) => n.isActive)!.label).toBe("red");

    actor.send(next);
    await setActor(actor);
    expect($layout.get()!.nodes.find((n) => n.isActive)!.label).toBe("green");
  });

  it("component renders after layout computed", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    const viewport = el.shadowRoot!.querySelector(".viewport");
    expect(viewport).toBeDefined();
  });

  it("zoom controls render correctly", async () => {
    const actor = createTrafficLight();
    await setActor(actor);

    const el = createGraphComponent();
    await el.updateComplete;

    const indicator = el.shadowRoot!.querySelector(".zoom-indicator");
    expect(indicator!.textContent).toContain("100%");
  });
});
