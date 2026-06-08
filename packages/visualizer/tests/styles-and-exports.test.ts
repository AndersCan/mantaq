// @vitest-environment jsdom
import { describe, it, expect } from "vite-plus/test";
import { applyDefaultStyles, removeDefaultStyles } from "../src/styles.ts";

describe("styles", () => {
  it("applyDefaultStyles injects style element", () => {
    applyDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style).toBeDefined();
    expect(style!.tagName).toBe("STYLE");
  });

  it("applyDefaultStyles sets correct text content", () => {
    applyDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style!.textContent).toContain("--viz-bg");
    expect(style!.textContent).toContain("--viz-border");
    expect(style!.textContent).toContain("data-theme");
  });

  it("applyDefaultStyles is idempotent", () => {
    applyDefaultStyles();
    applyDefaultStyles();

    const styles = document.querySelectorAll("#mantaq-visualizer-defaults");
    expect(styles.length).toBe(1);
  });

  it("removeDefaultStyles removes style element", () => {
    applyDefaultStyles();
    removeDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style).toBeNull();
  });

  it("removeDefaultStyles is safe when not applied", () => {
    removeDefaultStyles();
    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style).toBeNull();
  });

  it("default styles include dark mode variables", () => {
    applyDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style!.textContent).toContain('[data-theme="dark"]');
    expect(style!.textContent).toContain("--viz-bg: #111827");
  });

  it("default styles include node styling", () => {
    applyDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style!.textContent).toContain("--viz-node-bg");
    expect(style!.textContent).toContain("--viz-node-active-bg");
    expect(style!.textContent).toContain("--viz-node-border");
  });

  it("default styles include edge styling", () => {
    applyDefaultStyles();

    const style = document.getElementById("mantaq-visualizer-defaults");
    expect(style!.textContent).toContain("--viz-edge-color");
    expect(style!.textContent).toContain("--viz-edge-active");
    expect(style!.textContent).toContain("--viz-edge-label");
  });
});

describe("exports", () => {
  it("all expected exports are available", async () => {
    const mod = await import("../src/index.ts");

    expect(mod.buildGraph).toBeDefined();
    expect(mod.computeLayout).toBeDefined();
    expect(mod.setActor).toBeDefined();
    expect(mod.selectNode).toBeDefined();
    expect(mod.zoomIn).toBeDefined();
    expect(mod.zoomOut).toBeDefined();
    expect(mod.zoomToFit).toBeDefined();
    expect(mod.resetView).toBeDefined();
    expect(mod.setZoom).toBeDefined();
    expect(mod.setPan).toBeDefined();
    expect(mod.startActorSync).toBeDefined();
    expect(mod.applyDarkTheme).toBeDefined();
    expect(mod.removeDarkTheme).toBeDefined();
    expect(mod.applyDefaultStyles).toBeDefined();
    expect(mod.removeDefaultStyles).toBeDefined();
    expect(mod.ActorGraphComponent).toBeDefined();
    expect(mod.StateNode).toBeDefined();
    expect(mod.EdgePath).toBeDefined();
  });

  it("store atoms are exported", async () => {
    const mod = await import("../src/index.ts");

    expect(mod.$actor).toBeDefined();
    expect(mod.$graph).toBeDefined();
    expect(mod.$layout).toBeDefined();
    expect(mod.$selectedNodeId).toBeDefined();
    expect(mod.$zoom).toBeDefined();
    expect(mod.$pan).toBeDefined();
    expect(mod.$layoutError).toBeDefined();
    expect(mod.$isComputing).toBeDefined();
  });
});
