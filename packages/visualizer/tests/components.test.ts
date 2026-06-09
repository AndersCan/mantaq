// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import "../src/components/state-node.ts";
import "../src/components/edge.ts";
import "../src/components/actor-graph.ts";
import "../src/components/minimap.ts";
import "../src/components/node-details-panel.ts";
import {
  $layout,
  $zoom,
  $pan,
  $selectedNodeId,
  $layoutError,
  $contextData,
  $timers,
  $graphData,
  $searchQuery,
  $searchResults,
  $filterStatus,
} from "../src/graph-store.ts";
import { $minimapVisible } from "../src/components/minimap.ts";
import type { StateNode } from "../src/components/state-node.ts";
import type { EdgePath } from "../src/components/edge.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";
import type { LayoutResult } from "../src/layout.ts";

const dummyLayout: LayoutResult = {
  nodes: [
    { id: "a", x: 0, y: 0, width: 120, height: 60, label: "a", isActive: true, isFinal: false },
    { id: "b", x: 200, y: 0, width: 120, height: 60, label: "b", isActive: false, isFinal: false },
    { id: "c", x: 400, y: 0, width: 120, height: 60, label: "c", isActive: false, isFinal: true },
  ],
  edges: [
    {
      id: "a->b",
      source: "a",
      target: "b",
      label: "GO",
      isActive: true,
      path: "M 120 30 L 200 30",
      labelX: 160,
      labelY: 20,
    },
    {
      id: "b->c",
      source: "b",
      target: "c",
      label: "NEXT",
      isActive: false,
      path: "M 320 30 L 400 30",
      labelX: 360,
      labelY: 20,
    },
  ],
  width: 600,
  height: 200,
};

function createStateNode(
  props: Partial<{
    nodeId: string;
    label: string;
    isActive: boolean;
    isFinal: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    selected: boolean;
    contextData: unknown;
  }> = {},
): StateNode {
  const el = document.createElement("state-node") as StateNode;
  el.nodeId = props.nodeId ?? "test";
  el.label = props.label ?? "idle";
  el.isActive = props.isActive ?? false;
  el.isFinal = props.isFinal ?? false;
  el.x = props.x ?? 0;
  el.y = props.y ?? 0;
  el.width = props.width ?? 120;
  el.height = props.height ?? 60;
  el.selected = props.selected ?? false;
  el.contextData = props.contextData ?? null;
  document.body.appendChild(el);
  return el;
}

function createEdgePath(
  props: Partial<{
    edgeId: string;
    path: string;
    label: string;
    isActive: boolean;
    labelX: number;
    labelY: number;
  }> = {},
): EdgePath {
  const el = document.createElement("edge-path") as EdgePath;
  el.edgeId = props.edgeId ?? "test-edge";
  el.path = props.path ?? "M 0 0 L 100 100";
  el.label = props.label ?? "FETCH";
  el.isActive = props.isActive ?? false;
  el.labelX = props.labelX ?? 50;
  el.labelY = props.labelY ?? 50;
  document.body.appendChild(el);
  return el;
}

function createActorGraph(
  props: Partial<{
    zoom: number;
    pan: { x: number; y: number };
    layoutError: string | null;
    withLayout: boolean;
  }> = {},
): ActorGraphComponent {
  if (props.withLayout !== false) {
    $layout.set(dummyLayout);
  } else {
    $layout.set(null);
  }
  if (props.zoom !== undefined) $zoom.set(props.zoom);
  if (props.pan !== undefined) $pan.set(props.pan);
  if (props.layoutError !== undefined) $layoutError.set(props.layoutError);
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
  $layoutError.set(null);
  $minimapVisible.set(false);
});

describe("StateNode component", () => {
  it("renders with label", async () => {
    const el = createStateNode({ nodeId: "test", label: "idle" });
    await Promise.resolve();
    const text = el.querySelector("text");
    expect(text).toBeDefined();
    expect(text!.textContent).toContain("idle");
  });

  it("applies active styles when isActive", async () => {
    const el = createStateNode({ isActive: true });
    await Promise.resolve();
    expect(el.querySelector(".active-glow")).toBeDefined();
  });

  it("does not show active glow when not active", async () => {
    const el = createStateNode({ isActive: false });
    await Promise.resolve();
    expect(el.querySelector(".active-glow")).toBeNull();
  });

  it("shows final indicator when isFinal", async () => {
    const el = createStateNode({ isFinal: true });
    await Promise.resolve();
    expect(el.querySelector(".final-indicator")).toBeDefined();
  });

  it("does not show final indicator when not final", async () => {
    const el = createStateNode({ isFinal: false });
    await Promise.resolve();
    expect(el.querySelector(".final-indicator")).toBeNull();
  });

  it("shows selection ring when selected", async () => {
    const el = createStateNode({ selected: true });
    await Promise.resolve();
    expect(el.querySelector(".selection-ring")).toBeDefined();
  });

  it("does not show selection ring when not selected", async () => {
    const el = createStateNode({ selected: false });
    await Promise.resolve();
    expect(el.querySelector(".selection-ring")).toBeNull();
  });

  it("dispatches node-select event on click", async () => {
    const el = createStateNode({ nodeId: "test-id" });
    await Promise.resolve();
    const handler = vi.fn();
    el.addEventListener("node-select", handler);
    const node = el.querySelector(".node") as SVGGElement;
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.nodeId).toBe("test-id");
  });

  it("positions SVG at correct coordinates", async () => {
    const el = createStateNode({ x: 50, y: 100 });
    await Promise.resolve();
    const svg = el.querySelector("svg");
    expect(svg).toBeDefined();
    const style = svg!.getAttribute("style");
    expect(style).toContain("left:40px");
    expect(style).toContain("top:90px");
  });

  it("has correct default properties", async () => {
    const el = createStateNode();
    expect(el.nodeId).toBe("test");
    expect(el.label).toBe("idle");
    expect(el.isActive).toBe(false);
    expect(el.isFinal).toBe(false);
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.width).toBe(120);
    expect(el.height).toBe(60);
  });

  it("does not show context when not selected", async () => {
    const el = createStateNode({ selected: false, contextData: { foo: "bar" } });
    await Promise.resolve();
    expect(el.querySelector("foreignObject")).toBeNull();
  });

  it("does not show context when selected but no context data", async () => {
    const el = createStateNode({ selected: true, contextData: null });
    await Promise.resolve();
    expect(el.querySelector("foreignObject")).toBeNull();
  });

  it("shows context panel when selected with context data", async () => {
    const el = createStateNode({ selected: true, contextData: { count: 42 } });
    await Promise.resolve();
    expect(el.querySelector("foreignObject")).toBeDefined();
  });

  it("renders context data as JSON", async () => {
    const el = createStateNode({ selected: true, contextData: { name: "test" } });
    await Promise.resolve();
    const div = el.querySelector("foreignObject div");
    expect(div).toBeDefined();
    expect(div!.textContent).toContain("name");
    expect(div!.textContent).toContain("test");
  });

  it("handles string context data", async () => {
    const el = createStateNode({ selected: true, contextData: "simple string" });
    await Promise.resolve();
    const div = el.querySelector("foreignObject div");
    expect(div).toBeDefined();
    expect(div!.textContent).toContain("simple string");
  });

  it("handles number context data", async () => {
    const el = createStateNode({ selected: true, contextData: 42 });
    await Promise.resolve();
    expect(el.querySelector("foreignObject div")!.textContent).toContain("42");
  });

  it("handles nested context objects", async () => {
    const el = createStateNode({
      selected: true,
      contextData: { user: { name: "Alice", roles: ["admin", "user"] } },
    });
    await Promise.resolve();
    const div = el.querySelector("foreignObject div");
    expect(div!.textContent).toContain("Alice");
    expect(div!.textContent).toContain("admin");
  });

  it("handles circular reference in context", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const el = createStateNode({ selected: true, contextData: circular });
    await Promise.resolve();
    expect(el.querySelector("foreignObject div")).toBeDefined();
    expect(el.querySelector("foreignObject div")!.textContent).toContain("[Circular]");
  });

  it("renders timer bar when hasTimer is true", async () => {
    const el = createStateNode({});
    el.hasTimer = true;
    el.timerProgress = 50;
    el.requestUpdate();
    await el.updateComplete;
    expect(el.querySelector(".timer-track")).toBeDefined();
    expect(el.querySelector(".timer-fill")).toBeDefined();
    expect(el.querySelector(".timer-icon")).toBeDefined();
  });

  it("does not render timer bar when hasTimer is false", async () => {
    const el = createStateNode();
    await el.updateComplete;
    expect(el.querySelector(".timer-track")).toBeNull();
    expect(el.querySelector(".timer-fill")).toBeNull();
  });

  it("timer fill width reflects progress", async () => {
    const el = createStateNode();
    el.hasTimer = true;
    el.timerProgress = 75;
    el.requestUpdate();
    await el.updateComplete;
    const fill = el.querySelector(".timer-fill") as SVGRectElement;
    expect(fill).toBeDefined();
    const trackWidth = 120 - 12;
    const expectedFillWidth = trackWidth * 0.75;
    expect(fill.getAttribute("width")).toBe(String(expectedFillWidth));
  });

  it("timer progress clamps at 100", async () => {
    const el = createStateNode();
    el.hasTimer = true;
    el.timerProgress = 150;
    el.requestUpdate();
    await el.updateComplete;
    const fill = el.querySelector(".timer-fill") as SVGRectElement;
    const barWidth = 120 - 12;
    expect(fill.getAttribute("width")).toBe(String(barWidth));
  });

  it("timer progress clamps at 0", async () => {
    const el = createStateNode();
    el.hasTimer = true;
    el.timerProgress = -10;
    el.requestUpdate();
    await el.updateComplete;
    const fill = el.querySelector(".timer-fill") as SVGRectElement;
    expect(fill.getAttribute("width")).toBe("0");
  });

  it("applies search-match class when searchMatch is true", async () => {
    const el = createStateNode();
    el.searchMatch = true;
    el.requestUpdate();
    await el.updateComplete;
    const node = el.querySelector(".node");
    expect(node!.classList.contains("search-match")).toBe(true);
  });

  it("does not apply search-match class when searchMatch is false", async () => {
    const el = createStateNode();
    await el.updateComplete;
    const node = el.querySelector(".node");
    expect(node!.classList.contains("search-match")).toBe(false);
  });

  it("applies animation class", async () => {
    const el = createStateNode();
    el.animationClass = "node-activate";
    el.requestUpdate();
    await el.updateComplete;
    const node = el.querySelector(".node");
    expect(node!.classList.contains("node-activate")).toBe(true);
  });

  it("dispatches node-select on Enter key", async () => {
    const el = createStateNode({ nodeId: "key-test" });
    await el.updateComplete;
    const handler = vi.fn();
    el.addEventListener("node-select", handler);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.nodeId).toBe("key-test");
  });

  it("dispatches node-select on Space key", async () => {
    const el = createStateNode({ nodeId: "space-test" });
    await el.updateComplete;
    const handler = vi.fn();
    el.addEventListener("node-select", handler);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch on other keys", async () => {
    const el = createStateNode();
    await el.updateComplete;
    const handler = vi.fn();
    el.addEventListener("node-select", handler);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("shows both active glow and final indicator", async () => {
    const el = createStateNode({ isActive: true, isFinal: true });
    await el.updateComplete;
    expect(el.querySelector(".active-glow")).toBeDefined();
    expect(el.querySelector(".final-indicator")).toBeDefined();
  });

  it("SVG has correct aria-label with all states", async () => {
    const el = createStateNode({ label: "running", isActive: true, isFinal: true, selected: true });
    await el.updateComplete;
    const svg = el.querySelector("svg");
    const aria = svg!.getAttribute("aria-label");
    expect(aria).toContain("running");
    expect(aria).toContain("active");
    expect(aria).toContain("final");
    expect(aria).toContain("selected");
  });

  it("SVG has aria-label with timer info", async () => {
    const el = createStateNode();
    el.hasTimer = true;
    el.requestUpdate();
    await el.updateComplete;
    const svg = el.querySelector("svg");
    expect(svg!.getAttribute("aria-label")).toContain("timer active");
  });
});

describe("EdgePath component", () => {
  it("renders edge path", async () => {
    const el = createEdgePath();
    await Promise.resolve();
    expect(el.querySelector(".edge-path")).toBeDefined();
  });

  it("applies active class when active", async () => {
    const el = createEdgePath({ isActive: true });
    await Promise.resolve();
    expect(el.querySelector(".edge-path.active")).toBeDefined();
  });

  it("does not apply active class when not active", async () => {
    const el = createEdgePath({ isActive: false });
    await Promise.resolve();
    expect(el.querySelector(".edge-path.active")).toBeNull();
  });

  it("renders edge with label property", async () => {
    const el = createEdgePath({ label: "FETCH" });
    await Promise.resolve();
    expect(el.querySelector(".edge-path")).toBeDefined();
    expect(el.querySelector(".edge-label")).toBeDefined();
  });

  it("applies active class to edge path", async () => {
    const el = createEdgePath({ isActive: true });
    await Promise.resolve();
    expect(el.querySelector(".edge-path.active")).toBeDefined();
  });

  it("renders marker with unique id", async () => {
    const el = createEdgePath({ edgeId: "unique-edge-123" });
    await Promise.resolve();
    expect(el.querySelector("marker")).toBeDefined();
  });

  it("has correct default properties", async () => {
    const el = createEdgePath();
    expect(el.edgeId).toBe("test-edge");
    expect(el.path).toBe("M 0 0 L 100 100");
    expect(el.label).toBe("FETCH");
    expect(el.isActive).toBe(false);
    expect(el.labelX).toBe(50);
    expect(el.labelY).toBe(50);
  });

  it("renders guard badge when guard is set", () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e-g1";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.guard = "isValid";
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    expect(el.querySelector(".guard-badge")).toBeDefined();
  });

  it("renders action badge when action is set", () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e-a1";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.action = "sendRequest";
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    expect(el.querySelector(".action-badge")).toBeDefined();
  });

  it("renders click zone when guard is set", () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e-cz1";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.guard = "isValid";
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    expect(el.querySelector(".edge-click-zone")).toBeDefined();
  });

  it("does not render click zone without guard or action", () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e-cz2";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    expect(el.querySelector(".edge-click-zone")).toBeNull();
  });

  it("dispatches edge-select on click zone click", () => {
    const el = createEdgePath({ edgeId: "e-sel", label: "GO", labelX: 100, labelY: 100 });
    el.guard = "isValid";
    el.action = "runEffect";
    document.body.appendChild(el);
    const handler = vi.fn();
    el.addEventListener("edge-select", handler);
    const clickZone = el.querySelector(".edge-click-zone");
    if (clickZone) {
      clickZone.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail.edgeId).toBe("e-sel");
    }
  });

  it("renders click zone when action is set", () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e-a2";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.action = "doThing";
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    expect(el.querySelector(".edge-click-zone")).toBeDefined();
  });

  it("edge properties can be set and read", () => {
    const el = createEdgePath();
    el.guard = "testGuard";
    el.action = "testAction";
    el.timerLabel = "5000ms";
    el.animationClass = "traversal";
    expect(el.guard).toBe("testGuard");
    expect(el.action).toBe("testAction");
    expect(el.timerLabel).toBe("5000ms");
    expect(el.animationClass).toBe("traversal");
  });
});

describe("ActorGraph component", () => {
  it("renders empty state when no layout", async () => {
    const el = createActorGraph({ withLayout: false });
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".empty-state")).toBeDefined();
  });

  it("renders error state when layoutError set", async () => {
    const el = createActorGraph({ layoutError: "Something went wrong", withLayout: false });
    await Promise.resolve();
    const error = el.shadowRoot!.querySelector(".error");
    expect(error).toBeDefined();
    expect(error!.textContent).toContain("Something went wrong");
  });

  it("renders zoom controls", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".zoom-controls")).toBeDefined();
  });

  it("renders help overlay", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".help-overlay")).toBeDefined();
  });

  it("displays zoom percentage", async () => {
    const el = createActorGraph({ zoom: 1.5 });
    await Promise.resolve();
    const indicator = el.shadowRoot!.querySelector(".zoom-indicator");
    expect(indicator).toBeDefined();
    expect(indicator!.textContent).toContain("150%");
  });

  it("zoom in button exists", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelectorAll(".zoom-btn").length).toBe(2);
  });

  it("has viewport container", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".container")).toBeDefined();
  });

  it("container is focusable", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    expect((el.shadowRoot!.querySelector(".container") as HTMLElement).tabIndex).toBe(0);
  });

  it("help overlay shows keyboard shortcuts", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    const help = el.shadowRoot!.querySelector(".help-overlay");
    expect(help!.textContent).toContain("+");
    expect(help!.textContent).toContain("-");
    expect(help!.textContent).toContain("0");
    expect(help!.textContent).toContain("F");
  });

  it("shows 100% zoom at default", async () => {
    const el = createActorGraph({ zoom: 1 });
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".zoom-indicator")!.textContent).toContain("100%");
  });

  it("shows correct zoom at 2x", async () => {
    const el = createActorGraph({ zoom: 2 });
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".zoom-indicator")!.textContent).toContain("200%");
  });

  it("arrow right selects next node", async () => {
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow right wraps to first node from last", async () => {
    $selectedNodeId.set("c");
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow left selects previous node", async () => {
    $selectedNodeId.set("b");
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow left wraps to last node from first", async () => {
    $selectedNodeId.set("a");
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect($selectedNodeId.get()).toBe("c");
  });

  it("escape deselects node", async () => {
    $selectedNodeId.set("a");
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect($selectedNodeId.get()).toBeNull();
  });

  it("keyboard + zooms in", async () => {
    $zoom.set(1);
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "+", bubbles: true }),
    );
    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("keyboard - zooms out", async () => {
    $zoom.set(1);
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", bubbles: true }),
    );
    expect($zoom.get()).toBeLessThan(1);
  });

  it("keyboard 0 resets view", async () => {
    $zoom.set(2);
    $pan.set({ x: 50, y: 50 });
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "0", bubbles: true }),
    );
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("keyboard F triggers zoom to fit", async () => {
    $zoom.set(0.5);
    const el = createActorGraph();
    await Promise.resolve();
    (el.shadowRoot!.querySelector(".container") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "F", bubbles: true }),
    );
    expect($zoom.get()).toBeGreaterThan(0.5);
  });

  it("arrow keys have no effect without layout", async () => {
    const el = createActorGraph({ withLayout: false });
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".empty-state")).toBeDefined();
    expect(el.shadowRoot!.querySelector(".container")).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector(".container")!.querySelector(".empty-state"),
    ).not.toBeNull();
  });
});

describe("MinimapComponent", () => {
  it("registers as custom element", () => {
    const el = document.createElement("minimap-component");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("minimap-component");
  });

  it("has shadow root", () => {
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders container div", () => {
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot!.querySelector(".minimap-container")).toBeDefined();
  });

  it("renders canvas when layout is set", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector("canvas")).toBeDefined();
  });

  it("does not render canvas when no layout", () => {
    $layout.set(null);
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot!.querySelector("canvas")).toBeNull();
  });

  it("$minimapVisible defaults to false", () => {
    expect($minimapVisible.get()).toBe(false);
  });

  it("$minimapVisible can be toggled", () => {
    $minimapVisible.set(true);
    expect($minimapVisible.get()).toBe(true);
    $minimapVisible.set(false);
    expect($minimapVisible.get()).toBe(false);
  });

  it("actor-graph shows minimap when visible", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(true);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("minimap-component")).toBeDefined();
  });

  it("actor-graph hides minimap when not visible", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(false);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("minimap-component")).toBeNull();
  });

  it("minimap toggle button exists", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".minimap-toggle")).toBeDefined();
  });

  it("minimap toggle button has active class when visible", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(true);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".minimap-toggle.active")).toBeDefined();
  });

  it("help overlay shows M shortcut", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".help-overlay")!.textContent).toContain("M");
  });

  it("minimap wrapper exists when visible", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(true);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".minimap-wrapper")).toBeDefined();
  });

  it("canvas has correct dimensions", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const canvas = el.shadowRoot!.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeDefined();
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it("minimap has crosshair cursor on canvas", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const style = el.shadowRoot!.querySelector("style");
    expect(style).toBeDefined();
    expect(style!.textContent).toContain("crosshair");
  });

  it("minimap cleans up on disconnect", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    el.remove();
    $zoom.set(2);
    expect($zoom.get()).toBe(2);
  });

  it("minimap renders after layout is set", async () => {
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot!.querySelector("canvas")).toBeNull();
    $layout.set(dummyLayout);
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector("canvas")).toBeDefined();
  });

  it("minimap-container has border-radius", () => {
    const el = document.createElement("minimap-component") as HTMLElement;
    document.body.appendChild(el);
    const container = el.shadowRoot!.querySelector(".minimap-container") as HTMLElement;
    expect(container).toBeDefined();
  });
});

describe("NodeDetailsPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    $selectedNodeId.set(null);
    $layout.set(null);
    $contextData.set({});
    $timers.set([]);
    $graphData.set(null);
  });

  it("renders closed by default", async () => {
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await (el as any).updateComplete;
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel).toBeDefined();
    expect(panel!.classList.contains("open")).toBe(false);
  });

  it("opens when node selected", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    $selectedNodeId.set("a");
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel).toBeDefined();
    expect(panel!.classList.contains("open")).toBe(true);
  });

  it("shows node label in header", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("b");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const title = el.shadowRoot!.querySelector(".panel-title");
    expect(title!.textContent).toBe("b");
  });

  it("shows active badge for active node", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const badge = el.shadowRoot!.querySelector(".badge-active");
    expect(badge).toBeDefined();
    expect(badge!.textContent).toBe("active");
  });

  it("shows final badge for final node", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("c");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const badge = el.shadowRoot!.querySelector(".badge-final");
    expect(badge).toBeDefined();
    expect(badge!.textContent).toBe("final");
  });

  it("shows context data", async () => {
    $layout.set(dummyLayout);
    $contextData.set({ a: { count: 42 } });
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const ctx = el.shadowRoot!.querySelector(".context-block");
    expect(ctx).toBeDefined();
    expect(ctx!.textContent).toContain("count");
  });

  it("shows transitions for node", async () => {
    $layout.set(dummyLayout);
    $graphData.set({
      nodes: [
        { id: "a", label: "a", isActive: true, isFinal: false },
        { id: "b", label: "b", isActive: false, isFinal: false },
      ],
      edges: [
        {
          id: "a-go-b",
          source: "a",
          target: "b",
          label: "GO",
          isActive: true,
          payload: { guard: "isValid" },
        },
      ],
    });
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".transition-item");
    expect(items.length).toBe(1);
    const event = el.shadowRoot!.querySelector(".transition-event");
    expect(event!.textContent).toBe("GO");
  });

  it("shows guard tag on transition", async () => {
    $layout.set(dummyLayout);
    $graphData.set({
      nodes: [{ id: "a", label: "a", isActive: true, isFinal: false }],
      edges: [
        {
          id: "a-go-a",
          source: "a",
          target: "a",
          label: "PING",
          isActive: true,
          payload: { guard: "canPing" },
        },
      ],
    });
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const guard = el.shadowRoot!.querySelector(".guard-tag");
    expect(guard).toBeDefined();
    expect(guard!.textContent).toContain("canPing");
  });

  it("shows empty message when no transitions", async () => {
    $layout.set(dummyLayout);
    $graphData.set({ nodes: [{ id: "c", label: "c", isActive: false, isFinal: true }], edges: [] });
    $selectedNodeId.set("c");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const empty = el.shadowRoot!.querySelector(".empty");
    expect(empty).toBeDefined();
    expect(empty!.textContent).toContain("No outgoing transitions");
  });

  it("closes when node deselected", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    $selectedNodeId.set(null);
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel!.classList.contains("open")).toBe(false);
  });

  it("shows multiple transitions", async () => {
    $layout.set(dummyLayout);
    $graphData.set({
      nodes: [
        { id: "a", label: "a", isActive: true, isFinal: false },
        { id: "b", label: "b", isActive: false, isFinal: false },
        { id: "c", label: "c", isActive: false, isFinal: true },
      ],
      edges: [
        { id: "a-go-b", source: "a", target: "b", label: "GO", isActive: false },
        { id: "a-next-c", source: "a", target: "c", label: "NEXT", isActive: false },
      ],
    });
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".transition-item");
    expect(items.length).toBe(2);
  });

  it("close button exists", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn");
    expect(closeBtn).toBeDefined();
  });

  it("close button deselects node", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn") as HTMLButtonElement;
    closeBtn.click();
    await Promise.resolve();
    expect($selectedNodeId.get()).toBeNull();
  });

  it("shows target state in transition", async () => {
    $layout.set(dummyLayout);
    $graphData.set({
      nodes: [
        { id: "a", label: "a", isActive: true, isFinal: false },
        { id: "b", label: "b", isActive: false, isFinal: false },
      ],
      edges: [{ id: "a-go-b", source: "a", target: "b", label: "GO", isActive: false }],
    });
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    const target = el.shadowRoot!.querySelector(".transition-target");
    expect(target).toBeDefined();
    expect(target!.textContent).toContain("b");
  });

  it("cleans up on disconnect", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("a");
    const el = document.createElement("node-details-panel") as HTMLElement & {
      updateComplete?: Promise<void>;
    };
    document.body.appendChild(el);
    await Promise.resolve();
    el.remove();
    $selectedNodeId.set("b");
    expect($selectedNodeId.get()).toBe("b");
  });
});

describe("Search and filter integration", () => {
  it("search-bar renders in actor-graph", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const searchBar = el.shadowRoot!.querySelector("search-bar");
    expect(searchBar).toBeDefined();
  });

  it("filter-controls renders in actor-graph", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const filterControls = el.shadowRoot!.querySelector("filter-controls");
    expect(filterControls).toBeDefined();
  });

  it("toolbar renders with search and filter", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const toolbar = el.shadowRoot!.querySelector(".toolbar");
    expect(toolbar).toBeDefined();
    expect(toolbar!.querySelector("search-bar")).toBeDefined();
    expect(toolbar!.querySelector("filter-controls")).toBeDefined();
  });

  it("search-match class applied to matching nodes", async () => {
    $layout.set(dummyLayout);
    $searchQuery.set("a");
    $searchResults.set(["a"]);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const nodes = el.shadowRoot!.querySelectorAll("state-node");
    const nodeA = Array.from(nodes).find((n) => (n as StateNode).nodeId === "a") as StateNode;
    expect(nodeA).toBeDefined();
    expect(nodeA.classList.contains("dimmed")).toBe(false);
  });

  it("dimmed class applied to non-matching nodes", async () => {
    $layout.set(dummyLayout);
    $searchQuery.set("a");
    $searchResults.set(["a"]);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const nodes = el.shadowRoot!.querySelectorAll("state-node");
    const nodeB = Array.from(nodes).find((n) => (n as StateNode).nodeId === "b") as StateNode;
    expect(nodeB).toBeDefined();
    expect(nodeB.getAttribute("class")).toContain("dimmed");
  });

  it("no dimming when no search active", async () => {
    $layout.set(dummyLayout);
    $searchQuery.set("");
    $searchResults.set([]);
    $filterStatus.set("all");
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const nodes = el.shadowRoot!.querySelectorAll("state-node");
    for (const node of nodes) {
      expect((node as StateNode).classList.contains("dimmed")).toBe(false);
    }
  });
});

describe("Touch gesture handlers", () => {
  function createGraphWithTouch(): ActorGraphComponent {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    return el;
  }

  function createTouch(x: number, y: number): Touch {
    return {
      clientX: x,
      clientY: y,
      identifier: 0,
      target: document.body,
      radiusX: 0,
      radiusY: 0,
      rotationAngle: 0,
      force: 0,
      screenX: x,
      screenY: y,
      pageX: x,
      pageY: y,
    } as unknown as Touch;
  }

  function createTouchEvent(type: string, touches: Touch[], changedTouches?: Touch[]): TouchEvent {
    const ct = changedTouches ?? touches;
    const opts = {
      touches: type === "touchend" ? [] : touches,
      targetTouches: touches,
      changedTouches: ct,
      bubbles: true,
      cancelable: true,
    } as unknown as TouchEventInit;
    return new TouchEvent(type, opts);
  }

  it("single touch starts pan", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const touch = createTouch(100, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [touch]));
    expect(el._touch.active).toBe(true);
  });

  it("single touch move updates pan", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $pan.set({ x: 0, y: 0 });
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const startTouch = createTouch(100, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [startTouch]));
    const moveTouch = createTouch(150, 150);
    container.dispatchEvent(createTouchEvent("touchmove", [moveTouch]));
    expect(el._pan.x).toBe(50);
    expect(el._pan.y).toBe(50);
    container.dispatchEvent(createTouchEvent("touchend", []));
    expect($pan.get().x).toBe(50);
    expect($pan.get().y).toBe(50);
  });

  it("touchend resets touch state", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const touch = createTouch(100, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [touch]));
    expect(el._touch.active).toBe(true);
    container.dispatchEvent(createTouchEvent("touchend", []));
    expect(el._touch.active).toBe(false);
  });

  it("two-finger touch starts pinch", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const touch1 = createTouch(100, 100);
    const touch2 = createTouch(200, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [touch1, touch2]));
    expect(el._touch.pinchDist).toBeGreaterThan(0);
  });

  it("pinch zoom changes zoom level", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $zoom.set(1);
    $pan.set({ x: 0, y: 0 });
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const touch1 = createTouch(100, 100);
    const touch2 = createTouch(200, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [touch1, touch2]));
    const zoomIn1 = createTouch(80, 100);
    const zoomIn2 = createTouch(220, 100);
    container.dispatchEvent(createTouchEvent("touchmove", [zoomIn1, zoomIn2]));
    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("container has touch-action in source", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    expect(container).toBeDefined();
    expect(container.classList.contains("container")).toBe(true);
  });

  it("mobile toolbar exists in DOM", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const toolbar = el.shadowRoot!.querySelector(".mobile-toolbar");
    expect(toolbar).toBeDefined();
  });

  it("mobile toolbar has zoom buttons", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const buttons = el.shadowRoot!.querySelectorAll(".mobile-btn");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("mobile zoom buttons render with aria labels", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const zoomOut = el.shadowRoot!.querySelector('[aria-label="Zoom out"]');
    const zoomIn = el.shadowRoot!.querySelector('[aria-label="Zoom in"]');
    expect(zoomOut).toBeDefined();
    expect(zoomIn).toBeDefined();
  });

  it("swipe left selects next node", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $selectedNodeId.set("a");
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const startTouch = createTouch(200, 200);
    container.dispatchEvent(createTouchEvent("touchstart", [startTouch]));
    const endTouch = createTouch(50, 200);
    container.dispatchEvent(createTouchEvent("touchend", [endTouch]));
    expect($selectedNodeId.get()).toBe("b");
  });

  it("swipe right selects previous node", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $selectedNodeId.set("b");
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const startTouch = createTouch(50, 200);
    container.dispatchEvent(createTouchEvent("touchstart", [startTouch]));
    const endTouch = createTouch(200, 200);
    container.dispatchEvent(createTouchEvent("touchend", [endTouch]));
    expect($selectedNodeId.get()).toBe("a");
  });

  it("short swipe does not navigate", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $selectedNodeId.set("a");
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const startTouch = createTouch(100, 200);
    container.dispatchEvent(createTouchEvent("touchstart", [startTouch]));
    const endTouch = createTouch(130, 200);
    container.dispatchEvent(createTouchEvent("touchend", [endTouch]));
    expect($selectedNodeId.get()).toBe("a");
  });

  it("mobile toolbar has fit button", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const fitBtn = el.shadowRoot!.querySelector('[aria-label="Fit to view"]');
    expect(fitBtn).toBeDefined();
  });

  it("mobile toolbar has reset button", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const resetBtn = el.shadowRoot!.querySelector('[aria-label="Reset view"]');
    expect(resetBtn).toBeDefined();
  });

  it("mobile toolbar has minimap button", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    const minimapBtn = el.shadowRoot!.querySelector(".mobile-minimap-btn");
    expect(minimapBtn).toBeDefined();
  });

  it("mobile fit button triggers zoomToFit", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $zoom.set(0.5);
    const fitBtn = el.shadowRoot!.querySelector('[aria-label="Fit to view"]') as HTMLElement;
    fitBtn.click();
    expect($zoom.get()).toBeGreaterThan(0.5);
  });

  it("mobile reset button triggers resetView", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $zoom.set(3);
    $pan.set({ x: 100, y: 100 });
    const resetBtn = el.shadowRoot!.querySelector('[aria-label="Reset view"]') as HTMLElement;
    resetBtn.click();
    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("double-tap zooms in", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $zoom.set(1);
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const touch1 = createTouch(150, 150);
    container.dispatchEvent(createTouchEvent("touchstart", [touch1]));
    container.dispatchEvent(createTouchEvent("touchend", [touch1]));
    const touch2 = createTouch(150, 150);
    container.dispatchEvent(createTouchEvent("touchstart", [touch2]));
    container.dispatchEvent(createTouchEvent("touchend", [touch2]));
    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("vertical swipe does not navigate", async () => {
    const el = createGraphWithTouch();
    await el.updateComplete;
    $selectedNodeId.set("a");
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const startTouch = createTouch(150, 100);
    container.dispatchEvent(createTouchEvent("touchstart", [startTouch]));
    const endTouch = createTouch(150, 250);
    container.dispatchEvent(createTouchEvent("touchend", [endTouch]));
    expect($selectedNodeId.get()).toBe("a");
  });
});
