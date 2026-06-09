import { describe, it, expect, afterEach } from "vite-plus/test";
import "../src/components/actor-graph.ts";
import {
  $layout,
  $zoom,
  $pan,
  $selectedNodeId,
  $selectedNodeIds,
  selectAllNodes,
  deselectAllNodes,
  toggleNodeSelection,
  isNodeSelected,
} from "../src/graph-store.ts";
import type { LayoutResult } from "../src/layout.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";

const dummyLayout: LayoutResult = {
  nodes: [
    { id: "a", x: 0, y: 0, width: 120, height: 60, label: "a", isActive: true, isFinal: false },
    { id: "b", x: 200, y: 0, width: 120, height: 60, label: "b", isActive: false, isFinal: false },
    { id: "c", x: 400, y: 0, width: 120, height: 60, label: "c", isActive: false, isFinal: true },
  ],
  edges: [],
  width: 600,
  height: 200,
};

function createGraph(): ActorGraphComponent {
  $layout.set(dummyLayout);
  const el = document.createElement("actor-graph") as ActorGraphComponent;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  $layout.set(null);
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
  $selectedNodeId.set(null);
  $selectedNodeIds.set(new Set());
});

describe("$selectedNodeIds store", () => {
  it("defaults to empty set", () => {
    expect($selectedNodeIds.get().size).toBe(0);
  });

  it("selectAllNodes selects all", () => {
    selectAllNodes();
    expect($selectedNodeIds.get().size).toBe(0);
  });

  it("selectAllNodes with layout selects all nodes", async () => {
    const { Actor, state, event } = await import("@mantaq/core");
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
      transitions: { idle: { GO: () => ({ state: active }) } },
    });
    const { setActor } = await import("../src/graph-store.ts");
    await setActor(actor);
    selectAllNodes();
    const ids = $selectedNodeIds.get();
    expect(ids.size).toBe(2);
    expect(ids.has("idle")).toBe(true);
    expect(ids.has("active")).toBe(true);
  });

  it("deselectAllNodes clears selection", () => {
    $selectedNodeIds.set(new Set(["a", "b"]));
    deselectAllNodes();
    expect($selectedNodeIds.get().size).toBe(0);
  });

  it("toggleNodeSelection adds node", () => {
    toggleNodeSelection("a");
    expect($selectedNodeIds.get().has("a")).toBe(true);
  });

  it("toggleNodeSelection removes node", () => {
    $selectedNodeIds.set(new Set(["a"]));
    toggleNodeSelection("a");
    expect($selectedNodeIds.get().has("a")).toBe(false);
  });

  it("toggleNodeSelection preserves other selections", () => {
    $selectedNodeIds.set(new Set(["a"]));
    toggleNodeSelection("b");
    expect($selectedNodeIds.get().has("a")).toBe(true);
    expect($selectedNodeIds.get().has("b")).toBe(true);
  });

  it("isNodeSelected checks membership", () => {
    $selectedNodeIds.set(new Set(["a"]));
    expect(isNodeSelected("a")).toBe(true);
    expect(isNodeSelected("b")).toBe(false);
  });
});

describe("Ctrl+A / Ctrl+D keyboard shortcuts", () => {
  it("Ctrl+A triggers selectAllNodes", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    const ids = $selectedNodeIds.get();
    expect(ids.size).toBe(3);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });

  it("Ctrl+D triggers deselectAllNodes", async () => {
    $selectedNodeIds.set(new Set(["a", "b"]));
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }),
    );
    expect($selectedNodeIds.get().size).toBe(0);
  });

  it("Ctrl+A without layout does nothing", async () => {
    $layout.set(null);
    $selectedNodeIds.set(new Set());
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    expect($selectedNodeIds.get().size).toBe(0);
  });

  it("plain A key does not trigger selectAll", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect($selectedNodeIds.get().size).toBe(0);
  });
});
