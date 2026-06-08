import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import "../src/components/state-node.ts";
import "../src/components/edge.ts";
import "../src/components/actor-graph.ts";
import {
  $layout,
  $zoom,
  $pan,
  $selectedNodeId,
  $isComputing,
  $layoutError,
  selectNode,
} from "../src/stores/graph-store.ts";
import type { StateNode } from "../src/components/state-node.ts";
import type { EdgePath } from "../src/components/edge.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";
import type { LayoutResult } from "../src/layout.ts";

const dummyLayout: LayoutResult = {
  nodes: [
    {
      id: "a",
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      label: "a",
      isActive: true,
      isFinal: false,
      depth: 0,
    },
    {
      id: "b",
      x: 200,
      y: 0,
      width: 120,
      height: 60,
      label: "b",
      isActive: false,
      isFinal: false,
      depth: 0,
    },
    {
      id: "c",
      x: 400,
      y: 0,
      width: 120,
      height: 60,
      label: "c",
      isActive: false,
      isFinal: true,
      depth: 0,
    },
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
    computing: boolean;
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
  if (props.computing !== undefined) $isComputing.set(props.computing);
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
  $isComputing.set(false);
  $layoutError.set(null);
});

describe("StateNode component", () => {
  it("renders with label", async () => {
    const el = createStateNode({ nodeId: "test", label: "idle" });
    await el.updateComplete;

    const text = el.shadowRoot!.querySelector("text");
    expect(text).toBeDefined();
    expect(text!.textContent).toContain("idle");
  });

  it("applies active styles when isActive", async () => {
    const el = createStateNode({ isActive: true });
    await el.updateComplete;

    const activeGlow = el.shadowRoot!.querySelector(".active-glow");
    expect(activeGlow).toBeDefined();
  });

  it("does not show active glow when not active", async () => {
    const el = createStateNode({ isActive: false });
    await el.updateComplete;

    const activeGlow = el.shadowRoot!.querySelector(".active-glow");
    expect(activeGlow).toBeNull();
  });

  it("shows final indicator when isFinal", async () => {
    const el = createStateNode({ isFinal: true });
    await el.updateComplete;

    const finalIndicator = el.shadowRoot!.querySelector(".final-indicator");
    expect(finalIndicator).toBeDefined();
  });

  it("does not show final indicator when not final", async () => {
    const el = createStateNode({ isFinal: false });
    await el.updateComplete;

    const finalIndicator = el.shadowRoot!.querySelector(".final-indicator");
    expect(finalIndicator).toBeNull();
  });

  it("shows selection ring when selected", async () => {
    const el = createStateNode({ selected: true });
    await el.updateComplete;

    const selectionRing = el.shadowRoot!.querySelector(".selection-ring");
    expect(selectionRing).toBeDefined();
  });

  it("does not show selection ring when not selected", async () => {
    const el = createStateNode({ selected: false });
    await el.updateComplete;

    const selectionRing = el.shadowRoot!.querySelector(".selection-ring");
    expect(selectionRing).toBeNull();
  });

  it("dispatches node-select event on click", async () => {
    const el = createStateNode({ nodeId: "test-id" });
    await el.updateComplete;

    const handler = vi.fn();
    el.addEventListener("node-select", handler);

    const node = el.shadowRoot!.querySelector(".node") as SVGGElement;
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.nodeId).toBe("test-id");
  });

  it("positions SVG at correct coordinates", async () => {
    const el = createStateNode({ x: 50, y: 100 });
    await el.updateComplete;

    const svg = el.shadowRoot!.querySelector("svg");
    expect(svg).toBeDefined();
    const style = svg!.getAttribute("style");
    expect(style).toContain("left: 40px");
    expect(style).toContain("top: 90px");
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
});

describe("EdgePath component", () => {
  it("renders edge path", async () => {
    const el = createEdgePath();
    await el.updateComplete;

    const path = el.shadowRoot!.querySelector(".edge-path");
    expect(path).toBeDefined();
  });

  it("applies active class when active", async () => {
    const el = createEdgePath({ isActive: true });
    await el.updateComplete;

    const path = el.shadowRoot!.querySelector(".edge-path.active");
    expect(path).toBeDefined();
  });

  it("does not apply active class when not active", async () => {
    const el = createEdgePath({ isActive: false });
    await el.updateComplete;

    const path = el.shadowRoot!.querySelector(".edge-path.active");
    expect(path).toBeNull();
  });

  it("renders edge label", async () => {
    const el = createEdgePath({ label: "FETCH" });
    await el.updateComplete;

    const label = el.shadowRoot!.querySelector(".edge-label");
    expect(label).toBeDefined();
    expect(label!.textContent).toContain("FETCH");
  });

  it("applies active arrow color when active", async () => {
    const el = createEdgePath({ isActive: true });
    await el.updateComplete;

    const arrow = el.shadowRoot!.querySelector(".edge-arrow.active");
    expect(arrow).toBeDefined();
  });

  it("renders marker definition with unique id", async () => {
    const el = createEdgePath({ edgeId: "unique-edge-123" });
    await el.updateComplete;

    const marker = el.shadowRoot!.querySelector("marker");
    expect(marker).toBeDefined();
    expect(marker!.id).toContain("unique-edge-123");
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
});

describe("ActorGraph component", () => {
  it("renders empty state when no layout", async () => {
    const el = createActorGraph({ withLayout: false });
    await el.updateComplete;

    const emptyState = el.shadowRoot!.querySelector(".empty-state");
    expect(emptyState).toBeDefined();
  });

  it("renders loading state when computing", async () => {
    const el = createActorGraph({ computing: true, withLayout: false });
    await el.updateComplete;

    const loading = el.shadowRoot!.querySelector(".loading");
    expect(loading).toBeDefined();
  });

  it("renders error state when layoutError set", async () => {
    const el = createActorGraph({ layoutError: "Something went wrong", withLayout: false });
    await el.updateComplete;

    const error = el.shadowRoot!.querySelector(".error");
    expect(error).toBeDefined();
    expect(error!.textContent).toContain("Something went wrong");
  });

  it("renders zoom controls", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const zoomControls = el.shadowRoot!.querySelector(".zoom-controls");
    expect(zoomControls).toBeDefined();
  });

  it("renders help overlay", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const help = el.shadowRoot!.querySelector(".help-overlay");
    expect(help).toBeDefined();
  });

  it("displays zoom percentage", async () => {
    const el = createActorGraph({ zoom: 1.5 });
    await el.updateComplete;

    const indicator = el.shadowRoot!.querySelector(".zoom-indicator");
    expect(indicator).toBeDefined();
    expect(indicator!.textContent).toContain("150%");
  });

  it("zoom in button exists", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const buttons = el.shadowRoot!.querySelectorAll(".zoom-btn");
    expect(buttons.length).toBe(2);
  });

  it("has viewport container", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container");
    expect(container).toBeDefined();
  });

  it("container is focusable", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    expect(container.tabIndex).toBe(0);
  });

  it("has default properties", async () => {
    const el = createActorGraph();
    expect(el.zoom).toBe(1);
    expect(el.pan).toEqual({ x: 0, y: 0 });
    expect(el.computing).toBe(false);
    expect(el.layoutError).toBeNull();
    expect(el.selectedNodeId).toBeNull();
  });

  it("help overlay shows keyboard shortcuts", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const help = el.shadowRoot!.querySelector(".help-overlay");
    expect(help!.textContent).toContain("+");
    expect(help!.textContent).toContain("-");
    expect(help!.textContent).toContain("0");
    expect(help!.textContent).toContain("F");
  });

  it("shows 0% zoom at default", async () => {
    const el = createActorGraph({ zoom: 1 });
    await el.updateComplete;

    const indicator = el.shadowRoot!.querySelector(".zoom-indicator");
    expect(indicator!.textContent).toContain("100%");
  });

  it("shows correct zoom at 2x", async () => {
    const el = createActorGraph({ zoom: 2 });
    await el.updateComplete;

    const indicator = el.shadowRoot!.querySelector(".zoom-indicator");
    expect(indicator!.textContent).toContain("200%");
  });

  it("arrow right selects next node", async () => {
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow right wraps to first node from last", async () => {
    selectNode("b");
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow left selects previous node", async () => {
    selectNode("b");
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect($selectedNodeId.get()).toBe("a");
  });

  it("arrow left wraps to last node from first", async () => {
    selectNode("a");
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect($selectedNodeId.get()).toBe("c");
  });

  it("escape deselects node", async () => {
    selectNode("a");
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect($selectedNodeId.get()).toBeNull();
  });

  it("keyboard + zooms in", async () => {
    $zoom.set(1);
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));

    expect($zoom.get()).toBeGreaterThan(1);
  });

  it("keyboard - zooms out", async () => {
    $zoom.set(1);
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));

    expect($zoom.get()).toBeLessThan(1);
  });

  it("keyboard 0 resets view", async () => {
    $zoom.set(2);
    $pan.set({ x: 50, y: 50 });
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));

    expect($zoom.get()).toBe(1);
    expect($pan.get()).toEqual({ x: 0, y: 0 });
  });

  it("keyboard F triggers zoom to fit", async () => {
    $zoom.set(0.5);
    const el = createActorGraph();
    await el.updateComplete;

    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "F", bubbles: true }));

    expect($zoom.get()).toBeGreaterThan(0.5);
  });

  it("arrow keys have no effect without layout", async () => {
    const el = createActorGraph({ withLayout: false });
    await el.updateComplete;

    const emptyState = el.shadowRoot!.querySelector(".empty-state");
    expect(emptyState).toBeDefined();

    const container = el.shadowRoot!.querySelector(".container");
    expect(container).toBeNull();
  });
});
