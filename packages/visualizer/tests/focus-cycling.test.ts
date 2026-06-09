import { describe, it, expect, afterEach } from "vite-plus/test";
import "../src/components/actor-graph.ts";
import { $layout, $zoom, $pan, $selectedNodeId } from "../src/graph-store.ts";
import type { LayoutResult } from "../src/layout.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";

const dummyLayout: LayoutResult = {
  nodes: [
    { id: "a", x: 0, y: 0, width: 120, height: 60, label: "a", isActive: true, isFinal: false },
    { id: "b", x: 200, y: 0, width: 120, height: 60, label: "b", isActive: false, isFinal: false },
  ],
  edges: [],
  width: 400,
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
});

describe("Tab focus cycling", () => {
  it("Tab cycles to next interactive element", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    const active = el.shadowRoot!.activeElement;
    expect(active).not.toBeNull();
  });

  it("Shift+Tab cycles to previous element", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.focus();
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    const active = el.shadowRoot!.activeElement;
    expect(active).not.toBeNull();
  });

  it("Tab is prevented from default behavior", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+Tab is prevented from default behavior", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("_getInteractiveElements returns elements", async () => {
    const el = createGraph();
    await el.updateComplete;
    const elements = (el as any)._getInteractiveElements();
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBeGreaterThan(0);
  });

  it("interactive elements include zoom buttons", async () => {
    const el = createGraph();
    await el.updateComplete;
    const elements = (el as any)._getInteractiveElements();
    const zoomBtns = elements.filter((e: Element) => e.classList?.contains("zoom-btn"));
    expect(zoomBtns.length).toBe(2);
  });

  it("interactive elements include search-bar", async () => {
    const el = createGraph();
    await el.updateComplete;
    const elements = (el as any)._getInteractiveElements();
    const searchBars = elements.filter((e: Element) => e.tagName?.toLowerCase() === "search-bar");
    expect(searchBars.length).toBe(1);
  });
});
