import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { computeLayout, invalidateLayoutCache } from "../src/layout.ts";
import type { LayoutOptions } from "../src/layout.ts";
import "../src/components/layout-controls.ts";
import {
  $layoutAlgorithm,
  $edgeRouting,
  $layoutAnimation,
  $activePreset,
  $autoSize,
  $layout,
  LAYOUT_PRESETS,
  setLayoutAlgorithm,
  setEdgeRouting,
  toggleLayoutAnimation,
  toggleAutoSize,
  applyPreset,
} from "../src/graph-store.ts";
import type { LayoutControlsComponent } from "../src/components/layout-controls.ts";

interface TestGraph {
  nodes: Array<{ id: string; label: string; isActive: boolean; isFinal: boolean }>;
  edges: Array<{ id: string; source: string; target: string; label: string; isActive: boolean }>;
}

const testGraph: TestGraph = {
  nodes: [
    { id: "idle", label: "idle", isActive: true, isFinal: false },
    { id: "loading", label: "loading", isActive: false, isFinal: false },
    { id: "done", label: "done", isActive: false, isFinal: true },
  ],
  edges: [
    { id: "idle->loading", source: "idle", target: "loading", label: "FETCH", isActive: true },
    { id: "loading->done", source: "loading", target: "done", label: "SUCCESS", isActive: false },
  ],
};

const longLabelGraph: TestGraph = {
  nodes: [
    { id: "a", label: "short", isActive: true, isFinal: false },
    { id: "b", label: "this-is-a-very-long-state-name", isActive: false, isFinal: false },
    { id: "c", label: "x", isActive: false, isFinal: true },
  ],
  edges: [
    { id: "a->b", source: "a", target: "b", label: "GO", isActive: true },
    { id: "b->c", source: "b", target: "c", label: "DONE", isActive: false },
  ],
};

beforeEach(() => {
  invalidateLayoutCache();
});

describe("Layout algorithm options", () => {
  it("defaults to layered algorithm", async () => {
    const result = await computeLayout(testGraph);
    expect(result.nodes.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
  });

  it("supports force algorithm", async () => {
    const result = await computeLayout(testGraph, { algorithm: "force" });
    expect(result.nodes.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
  });

  it("supports stress algorithm", async () => {
    const result = await computeLayout(testGraph, { algorithm: "stress" });
    expect(result.nodes.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
  });

  it("supports mrtree algorithm", async () => {
    const result = await computeLayout(testGraph, { algorithm: "mrtree" });
    expect(result.nodes.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
  });

  it("produces valid coordinates for all algorithms", async () => {
    const algos: LayoutOptions["algorithm"][] = ["layered", "force", "stress", "mrtree"];
    for (const algo of algos) {
      invalidateLayoutCache();
      const result = await computeLayout(testGraph, { algorithm: algo });
      for (const node of result.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
      }
    }
  });
});

describe("Edge routing options", () => {
  it("defaults to orthogonal", async () => {
    const result = await computeLayout(testGraph);
    for (const edge of result.edges) {
      expect(edge.path).toBeTruthy();
    }
  });

  it("supports spline routing", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(testGraph, { edgeRouting: "spline" });
    expect(result.edges.length).toBe(2);
    for (const edge of result.edges) {
      expect(edge.path).toBeTruthy();
    }
  });

  it("supports polyline routing", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(testGraph, { edgeRouting: "polyline" });
    expect(result.edges.length).toBe(2);
    for (const edge of result.edges) {
      expect(edge.path).toBeTruthy();
    }
  });
});

describe("Auto-size nodes", () => {
  it("uses fixed width when autoSize is false", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(testGraph, { nodeWidth: 120, autoSize: false });
    for (const node of result.nodes) {
      expect(node.width).toBe(120);
    }
  });

  it("auto-sizes nodes based on label when autoSize is true", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(longLabelGraph, { nodeWidth: 100, autoSize: true });
    const shortNode = result.nodes.find((n) => n.label === "short");
    const longNode = result.nodes.find((n) => n.label === "this-is-a-very-long-state-name");
    expect(shortNode).toBeDefined();
    expect(longNode).toBeDefined();
    expect(longNode!.width).toBeGreaterThan(shortNode!.width);
  });

  it("auto-size respects minimum width", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(longLabelGraph, { nodeWidth: 100, autoSize: true });
    const shortNode = result.nodes.find((n) => n.label === "short");
    expect(shortNode!.width).toBeGreaterThanOrEqual(100);
  });

  it("auto-size caps at 2x base width", async () => {
    invalidateLayoutCache();
    const result = await computeLayout(longLabelGraph, { nodeWidth: 100, autoSize: true });
    const longNode = result.nodes.find((n) => n.label === "this-is-a-very-long-state-name");
    expect(longNode!.width).toBeLessThanOrEqual(200);
  });
});

describe("Cache invalidation", () => {
  it("invalidateLayoutCache forces recomputation", async () => {
    const result1 = await computeLayout(testGraph, { algorithm: "layered" });
    invalidateLayoutCache();
    const result2 = await computeLayout(testGraph, { algorithm: "force" });
    expect(result1.nodes.length).toBe(result2.nodes.length);
  });
});

describe("Layout store atoms", () => {
  afterEach(() => {
    $layoutAlgorithm.set("layered");
    $edgeRouting.set("orthogonal");
    $layoutAnimation.set(true);
    $activePreset.set(null);
    $autoSize.set(false);
    $layout.set(null);
  });

  it("$layoutAlgorithm defaults to layered", () => {
    expect($layoutAlgorithm.get()).toBe("layered");
  });

  it("setLayoutAlgorithm updates atom", () => {
    setLayoutAlgorithm("force");
    expect($layoutAlgorithm.get()).toBe("force");
  });

  it("setLayoutAlgorithm is no-op when same value", () => {
    $layoutAlgorithm.set("layered");
    setLayoutAlgorithm("layered");
    expect($layoutAlgorithm.get()).toBe("layered");
  });

  it("$edgeRouting defaults to orthogonal", () => {
    expect($edgeRouting.get()).toBe("orthogonal");
  });

  it("setEdgeRouting updates atom", () => {
    setEdgeRouting("spline");
    expect($edgeRouting.get()).toBe("spline");
  });

  it("$layoutAnimation defaults to true", () => {
    expect($layoutAnimation.get()).toBe(true);
  });

  it("toggleLayoutAnimation toggles value", () => {
    toggleLayoutAnimation();
    expect($layoutAnimation.get()).toBe(false);
    toggleLayoutAnimation();
    expect($layoutAnimation.get()).toBe(true);
  });

  it("$autoSize defaults to false", () => {
    expect($autoSize.get()).toBe(false);
  });

  it("toggleAutoSize toggles value", () => {
    toggleAutoSize();
    expect($autoSize.get()).toBe(true);
    toggleAutoSize();
    expect($autoSize.get()).toBe(false);
  });

  it("$activePreset defaults to null", () => {
    expect($activePreset.get()).toBeNull();
  });

  it("applyPreset sets algorithm and edgeRouting", () => {
    applyPreset("force");
    expect($layoutAlgorithm.get()).toBe("force");
    expect($edgeRouting.get()).toBe("spline");
    expect($activePreset.get()).toBe("force");
  });

  it("applyPreset with compact sets correct values", () => {
    applyPreset("compact");
    expect($layoutAlgorithm.get()).toBe("layered");
    expect($edgeRouting.get()).toBe("orthogonal");
    expect($activePreset.get()).toBe("compact");
  });

  it("applyPreset with vertical sets direction DOWN", () => {
    applyPreset("vertical");
    expect($activePreset.get()).toBe("vertical");
  });

  it("setLayoutAlgorithm clears active preset", () => {
    applyPreset("compact");
    expect($activePreset.get()).toBe("compact");
    setLayoutAlgorithm("force");
    expect($activePreset.get()).toBeNull();
  });

  it("setEdgeRouting clears active preset", () => {
    applyPreset("compact");
    expect($activePreset.get()).toBe("compact");
    setEdgeRouting("spline");
    expect($activePreset.get()).toBeNull();
  });
});

describe("LAYOUT_PRESETS", () => {
  it("has all expected presets", () => {
    const keys = Object.keys(LAYOUT_PRESETS);
    expect(keys).toContain("compact");
    expect(keys).toContain("spacious");
    expect(keys).toContain("horizontal");
    expect(keys).toContain("vertical");
    expect(keys).toContain("force");
    expect(keys).toContain("tree");
  });

  it("each preset has required fields", () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      expect(preset.name).toBeTruthy();
      expect(preset.algorithm).toBeTruthy();
      expect(preset.direction).toBeTruthy();
      expect(preset.edgeRouting).toBeTruthy();
      expect(preset.nodeWidth).toBeGreaterThan(0);
      expect(preset.nodeHeight).toBeGreaterThan(0);
    }
  });
});

describe("LayoutControls component", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    $layoutAlgorithm.set("layered");
    $edgeRouting.set("orthogonal");
    $layoutAnimation.set(true);
    $activePreset.set(null);
  });

  it("registers as custom element", () => {
    const el = document.createElement("layout-controls");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("layout-controls");
  });

  it("has shadow root", () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders toggle button", async () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".layout-btn");
    expect(btn).toBeDefined();
    expect(btn!.getAttribute("aria-label")).toBe("Layout options");
  });

  it("button has active class when open", async () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".layout-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect(btn.classList.contains("active")).toBe(true);
  });

  it("shows dropdown when open", async () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".layout-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    const dropdown = el.shadowRoot!.querySelector(".dropdown");
    expect(dropdown).toBeDefined();
  });

  it("dropdown has algorithm section", async () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".layout-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".dropdown-item");
    expect(items.length).toBeGreaterThan(0);
  });

  it("cleans up on disconnect", async () => {
    const el = document.createElement("layout-controls") as LayoutControlsComponent;
    document.body.appendChild(el);
    await Promise.resolve();
    el.remove();
    $layoutAlgorithm.set("force");
    expect($layoutAlgorithm.get()).toBe("force");
  });
});
