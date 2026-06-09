import { describe, it, expect, afterEach } from "vite-plus/test";
import { $shortcutOverlayVisible } from "../src/components/shortcut-overlay.ts";
import "../src/components/shortcut-overlay.ts";
import "../src/components/actor-graph.ts";
import { $shortcuts, DEFAULT_SHORTCUTS } from "../src/shortcut-registry.ts";
import { $layout, $zoom, $pan, $selectedNodeId } from "../src/graph-store.ts";
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
  $shortcutOverlayVisible.set(false);
  $shortcuts.set(DEFAULT_SHORTCUTS);
});

describe("ShortcutOverlay component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("shortcut-overlay");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("shortcut-overlay");
  });

  it("has shadow root", () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot).toBeDefined();
  });

  it("is hidden by default", () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    expect($shortcutOverlayVisible.get()).toBe(false);
    expect(el.shadowRoot!.querySelector(".overlay")).toBeNull();
  });

  it("shows when visible atom is true", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const overlay = el.shadowRoot!.querySelector(".overlay");
    expect(overlay).toBeDefined();
    expect(overlay!.classList.contains("open")).toBe(true);
  });

  it("renders shortcut categories", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const categories = el.shadowRoot!.querySelectorAll(".category-title");
    expect(categories.length).toBeGreaterThan(0);
  });

  it("renders shortcut rows", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const rows = el.shadowRoot!.querySelectorAll(".shortcut-row");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("renders kbd elements", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const kbds = el.shadowRoot!.querySelectorAll("kbd");
    expect(kbds.length).toBeGreaterThan(0);
  });

  it("has close button", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn");
    expect(closeBtn).toBeDefined();
  });

  it("close button hides overlay", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const closeBtn = el.shadowRoot!.querySelector(".close-btn") as HTMLButtonElement;
    closeBtn.click();
    expect($shortcutOverlayVisible.get()).toBe(false);
  });

  it("clicking backdrop hides overlay", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const overlay = el.shadowRoot!.querySelector(".overlay") as HTMLElement;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect($shortcutOverlayVisible.get()).toBe(false);
  });

  it("has dialog role", async () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    $shortcutOverlayVisible.set(true);
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector("[role='dialog']");
    expect(panel).toBeDefined();
  });

  it("cleans up on disconnect", () => {
    const el = document.createElement("shortcut-overlay") as HTMLElement;
    document.body.appendChild(el);
    el.remove();
    $shortcutOverlayVisible.set(true);
    expect($shortcutOverlayVisible.get()).toBe(true);
  });
});

describe("? key to toggle shortcut overlay", () => {
  it("pressing ? opens overlay", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect($shortcutOverlayVisible.get()).toBe(true);
  });

  it("pressing ? again closes overlay", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect($shortcutOverlayVisible.get()).toBe(true);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect($shortcutOverlayVisible.get()).toBe(false);
  });
});

describe("Home/End keyboard navigation", () => {
  it("Home selects first node", async () => {
    $selectedNodeId.set("c");
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect($selectedNodeId.get()).toBe("a");
  });

  it("End selects last node", async () => {
    $selectedNodeId.set("a");
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect($selectedNodeId.get()).toBe("c");
  });

  it("Home from first node stays on first", async () => {
    $selectedNodeId.set("a");
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect($selectedNodeId.get()).toBe("a");
  });

  it("End from last node stays on last", async () => {
    $selectedNodeId.set("c");
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect($selectedNodeId.get()).toBe("c");
  });

  it("Home with no selection selects first", async () => {
    $selectedNodeId.set(null);
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect($selectedNodeId.get()).toBe("a");
  });

  it("End with no selection selects last", async () => {
    $selectedNodeId.set(null);
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect($selectedNodeId.get()).toBe("c");
  });
});
