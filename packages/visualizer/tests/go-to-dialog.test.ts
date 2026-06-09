import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import {
  $goToDialogVisible,
  $goToQuery,
  $goToResults,
  $goToSelectedIndex,
  openGoToDialog,
  closeGoToDialog,
  goToNode,
  setGoToQuery,
  goToNextResult,
  goToPrevResult,
  goToConfirm,
} from "../src/components/go-to-dialog.ts";
import "../src/components/go-to-dialog.ts";
import "../src/components/actor-graph.ts";
import { $layout, $selectedNodeId, $pan } from "../src/graph-store.ts";
import type { LayoutResult } from "../src/layout.ts";
import type { ActorGraphComponent } from "../src/components/actor-graph.ts";

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
  $selectedNodeId.set(null);
  $pan.set({ x: 0, y: 0 });
  $goToDialogVisible.set(false);
  $goToQuery.set("");
  $goToResults.set([]);
  $goToSelectedIndex.set(0);
});

describe("GoToDialog component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("go-to-dialog");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("go-to-dialog");
  });

  it("is hidden by default", () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    expect($goToDialogVisible.get()).toBe(false);
    expect(el.shadowRoot!.querySelector(".dialog-backdrop")).toBeNull();
  });

  it("shows when openGoToDialog called", async () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    openGoToDialog();
    await Promise.resolve();
    expect($goToDialogVisible.get()).toBe(true);
    const backdrop = el.shadowRoot!.querySelector(".dialog-backdrop");
    expect(backdrop).toBeDefined();
  });

  it("has input field", async () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    openGoToDialog();
    await Promise.resolve();
    const input = el.shadowRoot!.querySelector(".dialog-input") as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.placeholder).toContain("node");
  });

  it("has dialog role", async () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    openGoToDialog();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector("[role='dialog']")).toBeDefined();
  });

  it("closeGoToDialog hides dialog", async () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    openGoToDialog();
    await Promise.resolve();
    closeGoToDialog();
    expect($goToDialogVisible.get()).toBe(false);
  });

  it("cleans up on disconnect", () => {
    const el = document.createElement("go-to-dialog") as HTMLElement;
    document.body.appendChild(el);
    el.remove();
    openGoToDialog();
    expect($goToDialogVisible.get()).toBe(true);
  });
});

describe("go-to search", () => {
  beforeEach(() => {
    $layout.set(dummyLayout);
  });

  it("setGoToQuery updates query atom", () => {
    setGoToQuery("idl");
    expect($goToQuery.get()).toBe("idl");
  });

  it("setGoToQuery populates results", () => {
    setGoToQuery("idl");
    expect($goToResults.get()).toContain("idle");
  });

  it("fuzzy match finds node", () => {
    setGoToQuery("act");
    expect($goToResults.get()).toContain("active");
  });

  it("case insensitive match", () => {
    setGoToQuery("IDLE");
    expect($goToResults.get()).toContain("idle");
  });

  it("empty query clears results", () => {
    setGoToQuery("idl");
    setGoToQuery("");
    expect($goToResults.get()).toEqual([]);
  });

  it("no match returns empty", () => {
    setGoToQuery("zzz");
    expect($goToResults.get()).toEqual([]);
  });
});

describe("go-to navigation", () => {
  beforeEach(() => {
    $layout.set(dummyLayout);
    $goToResults.set(["idle", "active", "done"]);
    $goToSelectedIndex.set(0);
  });

  it("goToNextResult increments index", () => {
    goToNextResult();
    expect($goToSelectedIndex.get()).toBe(1);
  });

  it("goToNextResult wraps around", () => {
    $goToSelectedIndex.set(2);
    goToNextResult();
    expect($goToSelectedIndex.get()).toBe(0);
  });

  it("goToPrevResult decrements index", () => {
    $goToSelectedIndex.set(1);
    goToPrevResult();
    expect($goToSelectedIndex.get()).toBe(0);
  });

  it("goToPrevResult wraps around", () => {
    $goToSelectedIndex.set(0);
    goToPrevResult();
    expect($goToSelectedIndex.get()).toBe(2);
  });

  it("goToNode selects and navigates", () => {
    goToNode("active");
    expect($selectedNodeId.get()).toBe("active");
    expect($goToDialogVisible.get()).toBe(false);
  });

  it("goToConfirm selects current result", () => {
    $goToSelectedIndex.set(1);
    goToConfirm();
    expect($selectedNodeId.get()).toBe("active");
    expect($goToDialogVisible.get()).toBe(false);
  });

  it("goToConfirm with empty results is no-op", () => {
    $goToResults.set([]);
    goToConfirm();
    expect($selectedNodeId.get()).toBeNull();
  });
});

describe("Ctrl+G to open go-to dialog", () => {
  it("Ctrl+G opens dialog", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true }),
    );
    expect($goToDialogVisible.get()).toBe(true);
  });

  it("Ctrl+G does not interfere with other shortcuts", async () => {
    const el = createGraph();
    await el.updateComplete;
    const container = el.shadowRoot!.querySelector(".container") as HTMLElement;
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect($goToDialogVisible.get()).toBe(false);
  });
});
