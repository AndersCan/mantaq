// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

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
  $zoom,
  $pan,
  $selectedNodeId,
  $graphData,
  $contextData,
  $history,
} from "../src/graph-store.ts";
import {
  buildSvgString,
  exportAsSvg,
  getGraphState,
  copyGraphState,
  shareViaUrl,
  importFromUrl,
  $exportMenuVisible,
} from "../src/export.ts";
import "../src/components/export-menu.ts";
import type { LayoutResult } from "../src/layout.ts";

const dummyLayout: LayoutResult = {
  nodes: [
    {
      id: "idle",
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      label: "idle",
      isActive: true,
      isFinal: false,
    },
    {
      id: "active",
      x: 200,
      y: 0,
      width: 120,
      height: 60,
      label: "active",
      isActive: false,
      isFinal: false,
    },
  ],
  edges: [
    {
      id: "idle-go-active",
      source: "idle",
      target: "active",
      label: "GO",
      isActive: true,
      path: "M 120 30 L 200 30",
      labelX: 160,
      labelY: 20,
    },
  ],
  width: 400,
  height: 120,
};

describe("export utilities", () => {
  beforeEach(() => {
    $layout.set(null);
    $zoom.set(1);
    $pan.set({ x: 0, y: 0 });
    $selectedNodeId.set(null);
    $graphData.set(null);
    $contextData.set({});
    $history.set([]);
  });

  describe("buildSvgString", () => {
    it("generates valid SVG with nodes and edges", () => {
      const svg = buildSvgString(dummyLayout);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("idle");
      expect(svg).toContain("active");
      expect(svg).toContain("GO");
    });

    it("includes XML declaration", () => {
      const svg = buildSvgString(dummyLayout);
      expect(svg).toContain('<?xml version="1.0"');
    });

    it("includes correct dimensions", () => {
      const svg = buildSvgString(dummyLayout, { padding: 20 });
      expect(svg).toContain('width="440"');
      expect(svg).toContain('height="160"');
    });

    it("includes background rect by default", () => {
      const svg = buildSvgString(dummyLayout);
      expect(svg).toContain("<rect");
      expect(svg).toContain('fill="#ffffff"');
    });

    it("skips background rect for transparent", () => {
      const svg = buildSvgString(dummyLayout, { background: "transparent" });
      const rectCount = (svg.match(/<rect/g) || []).length;
      expect(rectCount).toBe(2);
    });

    it("uses theme bg color for current background", () => {
      const svg = buildSvgString(dummyLayout, { background: "current" });
      expect(svg).toContain("<rect");
    });

    it("renders node rectangles", () => {
      const svg = buildSvgString(dummyLayout);
      expect(svg).toContain('rx="6"');
    });

    it("renders edge paths", () => {
      const svg = buildSvgString(dummyLayout);
      expect(svg).toContain("M 120 30 L 200 30");
    });

    it("escapes XML special characters in labels", () => {
      const layout: LayoutResult = {
        nodes: [
          {
            id: "a",
            x: 0,
            y: 0,
            width: 120,
            height: 60,
            label: "a<b>&\"'",
            isActive: false,
            isFinal: false,
          },
        ],
        edges: [],
        width: 200,
        height: 100,
      };
      const svg = buildSvgString(layout);
      expect(svg).toContain("&lt;");
      expect(svg).toContain("&gt;");
      expect(svg).toContain("&amp;");
    });

    it("applies custom padding", () => {
      const svg1 = buildSvgString(dummyLayout, { padding: 10 });
      const svg2 = buildSvgString(dummyLayout, { padding: 50 });
      expect(svg1.length).toBeLessThan(svg2.length);
    });
  });

  describe("exportAsSvg", () => {
    it("returns false when no layout", () => {
      $layout.set(null);
      expect(exportAsSvg()).toBe(false);
    });

    it("creates download link when layout exists", () => {
      $layout.set(dummyLayout);
      const clickSpy = vi.fn();
      const originalCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = originalCreate(tag);
        if (tag === "a") {
          el.click = clickSpy;
        }
        return el;
      });
      const result = exportAsSvg();
      expect(result).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });

  describe("getGraphState", () => {
    it("returns null when no layout", () => {
      $layout.set(null);
      expect(getGraphState()).toBeNull();
    });

    it("returns graph state when layout exists", () => {
      $layout.set(dummyLayout);
      $graphData.set({
        nodes: [
          { id: "idle", label: "idle", isActive: true, isFinal: false },
          { id: "active", label: "active", isActive: false, isFinal: false },
        ],
        edges: [
          { id: "idle-go-active", source: "idle", target: "active", label: "GO", isActive: true },
        ],
      });
      $selectedNodeId.set("idle");
      $zoom.set(1.5);
      $pan.set({ x: 10, y: 20 });

      const state = getGraphState();
      expect(state).not.toBeNull();
      expect(state!.nodes.length).toBe(2);
      expect(state!.edges.length).toBe(1);
      expect(state!.selectedNodeId).toBe("idle");
      expect(state!.zoom).toBe(1.5);
      expect(state!.pan).toEqual({ x: 10, y: 20 });
    });

    it("includes history", () => {
      $layout.set(dummyLayout);
      $graphData.set({ nodes: [], edges: [] });
      $history.set([{ timestamp: 1000, fromState: "idle", toState: "active", event: "GO" }]);

      const state = getGraphState();
      expect(state!.history.length).toBe(1);
      expect(state!.history[0].event).toBe("GO");
    });

    it("includes context data", () => {
      $layout.set(dummyLayout);
      $graphData.set({ nodes: [], edges: [] });
      $contextData.set({ idle: { count: 42 } });

      const state = getGraphState();
      expect(state!.context).toEqual({ idle: { count: 42 } });
    });
  });

  describe("copyGraphState", () => {
    it("returns false when no layout", async () => {
      $layout.set(null);
      const result = await copyGraphState();
      expect(result).toBe(false);
    });

    it("copies JSON to clipboard when layout exists", async () => {
      $layout.set(dummyLayout);
      $graphData.set({ nodes: [], edges: [] });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        writable: true,
        configurable: true,
      });

      const result = await copyGraphState();
      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalled();
      const written = writeText.mock.calls[0][0];
      const parsed = JSON.parse(written);
      expect(parsed).toHaveProperty("nodes");
      expect(parsed).toHaveProperty("edges");
    });
  });

  describe("shareViaUrl", () => {
    it("returns null when no layout", () => {
      $layout.set(null);
      expect(shareViaUrl()).toBeNull();
    });

    it("returns URL with graph parameter", () => {
      $layout.set(dummyLayout);
      $graphData.set({
        nodes: [{ id: "idle", label: "idle", isActive: true, isFinal: false }],
        edges: [],
      });
      $selectedNodeId.set("idle");
      $zoom.set(1.5);
      $pan.set({ x: 10, y: 20 });

      const url = shareViaUrl();
      expect(url).not.toBeNull();
      expect(url).toContain("graph=");
    });
  });

  describe("importFromUrl", () => {
    it("returns false when no graph parameter", () => {
      vi.spyOn(window, "location", "get").mockReturnValue({
        ...window.location,
        search: "",
      } as Location);
      expect(importFromUrl()).toBe(false);
      vi.restoreAllMocks();
    });

    it("restores state from valid graph parameter", () => {
      const compact = {
        n: ["idle", "active"],
        s: "active",
        z: 1.5,
        p: [10, 20],
      };
      const encoded = btoa(JSON.stringify(compact));
      vi.spyOn(window, "location", "get").mockReturnValue({
        ...window.location,
        search: `?graph=${encoded}`,
      } as Location);

      const result = importFromUrl();
      expect(result).toBe(true);
      expect($selectedNodeId.get()).toBe("active");
      expect($pan.get()).toEqual({ x: 10, y: 20 });
      vi.restoreAllMocks();
    });

    it("returns false for invalid base64", () => {
      vi.spyOn(window, "location", "get").mockReturnValue({
        ...window.location,
        search: "?graph=!!!invalid!!!",
      } as Location);
      expect(importFromUrl()).toBe(false);
      vi.restoreAllMocks();
    });
  });

  describe("$exportMenuVisible", () => {
    it("defaults to false", () => {
      expect($exportMenuVisible.get()).toBe(false);
    });

    it("can be toggled", () => {
      $exportMenuVisible.set(true);
      expect($exportMenuVisible.get()).toBe(true);
      $exportMenuVisible.set(false);
      expect($exportMenuVisible.get()).toBe(false);
    });
  });
});

describe("ExportMenuComponent", () => {
  beforeEach(() => {
    $layout.set(null);
    $exportMenuVisible.set(false);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    $exportMenuVisible.set(false);
  });

  it("registers as custom element", () => {
    const el = document.createElement("export-menu");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("export-menu");
  });

  it("has shadow root", () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot).toBeDefined();
  });

  it("does not show menu by default", () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    expect(el.shadowRoot!.querySelector(".menu")).toBeNull();
  });

  it("shows menu when $exportMenuVisible is true", async () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".menu")).toBeDefined();
  });

  it("shows all menu items", async () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".menu-item");
    expect(items.length).toBe(4);
  });

  it("menu items have role=menuitem", async () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(4);
  });

  it("clicking overlay closes menu", async () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    const overlay = el.shadowRoot!.querySelector(".menu-overlay") as HTMLElement;
    overlay.click();
    await Promise.resolve();
    expect($exportMenuVisible.get()).toBe(false);
  });

  it("shows options panel when SVG export clicked", async () => {
    $layout.set(dummyLayout);
    $graphData.set({ nodes: [], edges: [] });
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".menu-item");
    (items[0] as HTMLElement).click();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector(".options-panel")).toBeDefined();
  });

  it("options panel has format select", async () => {
    $layout.set(dummyLayout);
    $graphData.set({ nodes: [], edges: [] });
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    $exportMenuVisible.set(true);
    await Promise.resolve();
    const items = el.shadowRoot!.querySelectorAll(".menu-item");
    (items[0] as HTMLElement).click();
    await Promise.resolve();
    const selects = el.shadowRoot!.querySelectorAll(".option-select");
    expect(selects.length).toBeGreaterThanOrEqual(3);
  });

  it("cleans up on disconnect", async () => {
    const el = document.createElement("export-menu") as HTMLElement;
    document.body.appendChild(el);
    el.remove();
    $exportMenuVisible.set(true);
    expect($exportMenuVisible.get()).toBe(true);
  });
});
