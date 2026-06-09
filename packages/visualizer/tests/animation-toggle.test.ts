// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vite-plus/test";

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

import "../src/components/animation-toggle.ts";
import { $animationEnabled, $animationSpeed, $prefersReducedMotion } from "../src/graph-store.ts";
import type { AnimationToggleComponent } from "../src/components/animation-toggle.ts";

function createAnimationToggle(): AnimationToggleComponent {
  const el = document.createElement("animation-toggle") as AnimationToggleComponent;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  $animationEnabled.set(true);
  $animationSpeed.set(1);
  $prefersReducedMotion.set(false);
});

describe("AnimationToggle component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("animation-toggle");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("animation-toggle");
  });

  it("has shadow root", () => {
    const el = createAnimationToggle();
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders toggle button", async () => {
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn");
    expect(btn).toBeDefined();
  });

  it("renders speed buttons", async () => {
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    expect(speedBtns.length).toBe(4);
  });

  it("shows 0.5x, 1x, 2x, 4x speed options", async () => {
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const labels = Array.from(speedBtns).map((b) => b.textContent!.trim());
    expect(labels).toContain("0.5x");
    expect(labels).toContain("1x");
    expect(labels).toContain("2x");
    expect(labels).toContain("4x");
  });

  it("toggle button has active class when enabled", async () => {
    $animationEnabled.set(true);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn");
    expect(btn!.classList.contains("active")).toBe(true);
  });

  it("toggle button has no active class when disabled", async () => {
    $animationEnabled.set(false);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn");
    expect(btn!.classList.contains("active")).toBe(false);
  });

  it("click toggles animation off", async () => {
    $animationEnabled.set(true);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($animationEnabled.get()).toBe(false);
  });

  it("click toggles animation on", async () => {
    $animationEnabled.set(false);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($animationEnabled.get()).toBe(true);
  });

  it("1x speed button has active class at speed 1", async () => {
    $animationSpeed.set(1);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const btn1x = Array.from(speedBtns).find((b) => b.textContent!.trim() === "1x");
    expect(btn1x!.classList.contains("active")).toBe(true);
  });

  it("clicking 0.5x sets speed to 0.5", async () => {
    $animationSpeed.set(1);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const btn = Array.from(speedBtns).find(
      (b) => b.textContent!.trim() === "0.5x",
    ) as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($animationSpeed.get()).toBe(0.5);
  });

  it("clicking 2x sets speed to 2", async () => {
    $animationSpeed.set(1);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const btn = Array.from(speedBtns).find(
      (b) => b.textContent!.trim() === "2x",
    ) as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($animationSpeed.get()).toBe(2);
  });

  it("clicking 4x sets speed to 4", async () => {
    $animationSpeed.set(1);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const btn = Array.from(speedBtns).find(
      (b) => b.textContent!.trim() === "4x",
    ) as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($animationSpeed.get()).toBe(4);
  });

  it("speed group has correct aria-label", async () => {
    const el = createAnimationToggle();
    await Promise.resolve();
    const group = el.shadowRoot!.querySelector("[role='group']");
    expect(group).toBeDefined();
    expect(group!.getAttribute("aria-label")).toContain("speed");
  });

  it("toggle button has correct aria-label when enabled", async () => {
    $animationEnabled.set(true);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toContain("Disable");
  });

  it("toggle button has correct aria-label when disabled", async () => {
    $animationEnabled.set(false);
    const el = createAnimationToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".anim-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toContain("Enable");
  });

  it("speed buttons disabled when animation is off", async () => {
    $animationEnabled.set(false);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    for (const btn of speedBtns) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("speed buttons enabled when animation is on", async () => {
    $animationEnabled.set(true);
    const el = createAnimationToggle();
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    for (const btn of speedBtns) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("cleans up subscriptions on disconnect", async () => {
    const el = createAnimationToggle();
    await Promise.resolve();
    el.remove();
    $animationEnabled.set(false);
    expect($animationEnabled.get()).toBe(false);
  });

  it("updates when animation speed changes externally", async () => {
    $animationSpeed.set(1);
    const el = createAnimationToggle();
    await Promise.resolve();
    $animationSpeed.set(2);
    await Promise.resolve();
    const speedBtns = el.shadowRoot!.querySelectorAll(".speed-btn");
    const btn2x = Array.from(speedBtns).find((b) => b.textContent!.trim() === "2x");
    expect(btn2x!.classList.contains("active")).toBe(true);
  });
});
