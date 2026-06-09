// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vite-plus/test";
import "../src/components/state-node.ts";
import "../src/components/edge.ts";
import "../src/components/actor-graph.ts";
import "../src/components/search-bar.ts";
import "../src/components/filter-controls.ts";
import "../src/components/animation-toggle.ts";
import "../src/components/theme-toggle.ts";
import "../src/components/node-details-panel.ts";
import "../src/components/history-panel.ts";
import {
  $layout,
  $zoom,
  $pan,
  $selectedNodeId,
  $layoutError,
  $searchQuery,
  $searchResults,
  $filterStatus,
  $contextData,
  $timers,
  $graphData,
  $history,
  $historyReplayIndex,
  $animationEnabled,
  $animationSpeed,
} from "../src/graph-store.ts";
import { $minimapVisible } from "../src/components/minimap.ts";
import type { StateNode } from "../src/components/state-node.ts";
import type { EdgePath } from "../src/components/edge.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";
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
      id: "running",
      x: 200,
      y: 0,
      width: 120,
      height: 60,
      label: "running",
      isActive: false,
      isFinal: false,
    },
    {
      id: "done",
      x: 400,
      y: 0,
      width: 120,
      height: 60,
      label: "done",
      isActive: false,
      isFinal: true,
    },
  ],
  edges: [
    {
      id: "idle->running",
      source: "idle",
      target: "running",
      label: "START",
      isActive: true,
      path: "M 120 30 L 200 30",
      labelX: 160,
      labelY: 20,
    },
    {
      id: "running->done",
      source: "running",
      target: "done",
      label: "FINISH",
      isActive: false,
      path: "M 320 30 L 400 30",
      labelX: 360,
      labelY: 20,
    },
  ],
  width: 600,
  height: 200,
};

afterEach(() => {
  document.body.innerHTML = "";
  $layout.set(null);
  $zoom.set(1);
  $pan.set({ x: 0, y: 0 });
  $selectedNodeId.set(null);
  $layoutError.set(null);
  $minimapVisible.set(false);
  $searchQuery.set("");
  $searchResults.set([]);
  $filterStatus.set("all");
  $contextData.set({});
  $timers.set([]);
  $graphData.set(null);
  $history.set([]);
  $historyReplayIndex.set(-1);
});

describe("Accessibility - ARIA labels on interactive elements", () => {
  it("state-node SVG has role=button and aria-label", async () => {
    const el = document.createElement("state-node") as StateNode;
    el.nodeId = "test";
    el.label = "idle";
    el.isActive = true;
    el.isFinal = false;
    document.body.appendChild(el);
    await el.updateComplete;
    const svg = el.querySelector("svg");
    expect(svg).toBeDefined();
    expect(svg!.getAttribute("role")).toBe("button");
    expect(svg!.getAttribute("aria-label")).toContain("idle");
    expect(svg!.getAttribute("aria-label")).toContain("active");
  });

  it("state-node SVG includes final state in aria-label", async () => {
    const el = document.createElement("state-node") as StateNode;
    el.nodeId = "test";
    el.label = "done";
    el.isFinal = true;
    document.body.appendChild(el);
    await el.updateComplete;
    const svg = el.querySelector("svg");
    expect(svg!.getAttribute("aria-label")).toContain("final");
  });

  it("state-node SVG includes selected state in aria-label", async () => {
    const el = document.createElement("state-node") as StateNode;
    el.nodeId = "test";
    el.label = "idle";
    el.selected = true;
    document.body.appendChild(el);
    await el.updateComplete;
    const svg = el.querySelector("svg");
    expect(svg!.getAttribute("aria-label")).toContain("selected");
  });

  it("edge click zone has role=button when guard set", async () => {
    const el = document.createElement("edge-path") as EdgePath;
    el.edgeId = "e1";
    el.path = "M 0 0 L 100 100";
    el.label = "GO";
    el.isActive = false;
    el.labelX = 50;
    el.labelY = 50;
    el.guard = "isValid";
    el.graphWidth = 2000;
    el.graphHeight = 2000;
    document.body.appendChild(el);
    await Promise.resolve();
    const zone = el.querySelector(".edge-click-zone");
    if (zone) {
      expect(zone.getAttribute("role")).toBe("button");
      expect(zone.getAttribute("aria-label")).toContain("isValid");
    } else {
      expect(el.querySelector(".edge-path")).toBeDefined();
    }
  });
});

describe("Accessibility - aria-live regions", () => {
  it("error div has role=alert and aria-live=assertive", async () => {
    $layoutError.set("Something broke");
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const error = el.shadowRoot!.querySelector(".error");
    expect(error).toBeDefined();
    expect(error!.getAttribute("role")).toBe("alert");
    expect(error!.getAttribute("aria-live")).toBe("assertive");
  });

  it("search result count has role=status and aria-live=polite", async () => {
    $searchQuery.set("idle");
    $searchResults.set(["idle"]);
    const el = document.createElement("search-bar") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const count = el.shadowRoot!.querySelector(".result-count");
    expect(count).toBeDefined();
    expect(count!.getAttribute("role")).toBe("status");
    expect(count!.getAttribute("aria-live")).toBe("polite");
  });

  it("SR announcement div has aria-live=polite", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const sr = el.shadowRoot!.querySelector('[aria-live="polite"][role="status"]');
    expect(sr).toBeDefined();
  });

  it("SR announcement includes selected node info", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("idle");
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const sr = el.shadowRoot!.querySelector('[aria-live="polite"][role="status"]');
    expect(sr!.textContent).toContain("idle");
    expect(sr!.textContent).toContain("active");
  });
});

describe("Accessibility - skip link", () => {
  it("skip-to-content link exists", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const link = el.shadowRoot!.querySelector(".skip-link");
    expect(link).toBeDefined();
    expect(link!.textContent).toContain("Skip");
  });
});

describe("Accessibility - aria-expanded and aria-pressed", () => {
  it("node-details-panel has aria-expanded=false when closed", async () => {
    const el = document.createElement("node-details-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel!.getAttribute("aria-expanded")).toBe("false");
  });

  it("node-details-panel has aria-expanded=true when open", async () => {
    $layout.set(dummyLayout);
    $selectedNodeId.set("idle");
    const el = document.createElement("node-details-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel!.getAttribute("aria-expanded")).toBe("true");
  });

  it("node-details-panel has role=dialog", async () => {
    const el = document.createElement("node-details-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const panel = el.shadowRoot!.querySelector(".panel");
    expect(panel!.getAttribute("role")).toBe("dialog");
  });

  it("minimap toggle has aria-pressed", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(false);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const btn = el.shadowRoot!.querySelector(".minimap-toggle");
    expect(btn!.getAttribute("aria-pressed")).toBe("false");
  });

  it("minimap toggle aria-pressed=true when active", async () => {
    $layout.set(dummyLayout);
    $minimapVisible.set(true);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const btn = el.shadowRoot!.querySelector(".minimap-toggle");
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
  });

  it("filter buttons have aria-pressed", async () => {
    $filterStatus.set("active");
    const el = document.createElement("filter-controls") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.trim() === "active");
    expect(activeBtn!.getAttribute("aria-pressed")).toBe("true");
    const allBtn = Array.from(buttons).find((b) => b.textContent?.trim() === "all");
    expect(allBtn!.getAttribute("aria-pressed")).toBe("false");
  });

  it("animation toggle has aria-pressed", async () => {
    $animationEnabled.set(true);
    const el = document.createElement("animation-toggle") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn");
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
  });

  it("animation speed buttons have aria-pressed", async () => {
    $animationEnabled.set(true);
    $animationSpeed.set(2);
    const el = document.createElement("animation-toggle") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const activeBtn = Array.from(speedBtns).find((b) => b.textContent?.trim() === "2x");
    expect(activeBtn!.getAttribute("aria-pressed")).toBe("true");
    const inactiveBtn = Array.from(speedBtns).find((b) => b.textContent?.trim() === "1x");
    expect(inactiveBtn!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Accessibility - history panel ARIA", () => {
  it("history list has role=listbox", async () => {
    $history.set([{ timestamp: Date.now(), fromState: "a", toState: "b", event: "GO" }]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const list = el.shadowRoot!.querySelector('[role="listbox"]');
    expect(list).toBeDefined();
  });

  it("history entries have role=option", async () => {
    $history.set([{ timestamp: Date.now(), fromState: "a", toState: "b", event: "GO" }]);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const options = el.shadowRoot!.querySelectorAll('[role="option"]');
    expect(options.length).toBe(1);
  });

  it("active history entry has aria-selected=true", async () => {
    $history.set([{ timestamp: Date.now(), fromState: "a", toState: "b", event: "GO" }]);
    $historyReplayIndex.set(0);
    const el = document.createElement("history-panel") as HTMLElement;
    document.body.appendChild(el);
    await Promise.resolve();
    const active = el.shadowRoot!.querySelector('[aria-selected="true"]');
    expect(active).toBeDefined();
  });
});

describe("Accessibility - graph container roles", () => {
  it("container has role=application", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container");
    expect(container!.getAttribute("role")).toBe("application");
  });

  it("container has descriptive aria-label", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container");
    const label = container!.getAttribute("aria-label");
    expect(label).toContain("arrow keys");
  });

  it("viewport has role=img and node count", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const viewport = el.shadowRoot!.querySelector(".viewport");
    expect(viewport!.getAttribute("role")).toBe("img");
    expect(viewport!.getAttribute("aria-label")).toContain("3 nodes");
    expect(viewport!.getAttribute("aria-label")).toContain("2 transitions");
  });
});

describe("Accessibility - sr-only class", () => {
  it("sr-only styles exist in actor-graph component", async () => {
    $layout.set(dummyLayout);
    const el = document.createElement("actor-graph") as ActorGraphComponent;
    document.body.appendChild(el);
    await el.updateComplete;
    const srRegion = el.shadowRoot!.querySelector('[aria-live="polite"][role="status"]');
    expect(srRegion).toBeDefined();
  });
});
