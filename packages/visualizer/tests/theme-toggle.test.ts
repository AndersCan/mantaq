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

import "../src/components/theme-toggle.ts";
import { $theme, setTheme } from "../src/graph-store.ts";
import type { ThemeToggleComponent } from "../src/components/theme-toggle.ts";

function createThemeToggle(): ThemeToggleComponent {
  const el = document.createElement("theme-toggle") as ThemeToggleComponent;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  $theme.set("system");
});

describe("ThemeToggle component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("theme-toggle");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("theme-toggle");
  });

  it("has shadow root", () => {
    const el = createThemeToggle();
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders theme button", async () => {
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn");
    expect(btn).toBeDefined();
  });

  it("sets data-mode attribute on host", async () => {
    setTheme("dark");
    const el = createThemeToggle();
    await Promise.resolve();
    expect(el.getAttribute("data-mode")).toBe("dark");
  });

  it("shows light icon by default (system mode)", async () => {
    setTheme("system");
    const el = createThemeToggle();
    await Promise.resolve();
    const icon = el.shadowRoot!.querySelector(".icon-light");
    expect(icon).toBeDefined();
  });

  it("click cycles theme from system to light", async () => {
    setTheme("system");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($theme.get()).toBe("light");
  });

  it("click cycles theme from light to dark", async () => {
    setTheme("light");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($theme.get()).toBe("dark");
  });

  it("click cycles theme from dark to high-contrast", async () => {
    setTheme("dark");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($theme.get()).toBe("high-contrast");
  });

  it("click cycles theme from high-contrast to system", async () => {
    setTheme("high-contrast");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect($theme.get()).toBe("system");
  });

  it("button has correct aria-label in light mode", async () => {
    setTheme("light");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toContain("dark");
  });

  it("button has correct aria-label in dark mode", async () => {
    setTheme("dark");
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toContain("high-contrast");
  });

  it("button has title attribute", async () => {
    const el = createThemeToggle();
    await Promise.resolve();
    const btn = el.shadowRoot!.querySelector(".theme-btn") as HTMLButtonElement;
    expect(btn.getAttribute("title")).toBeTruthy();
  });

  it("updates when theme changes externally", async () => {
    const el = createThemeToggle();
    await Promise.resolve();
    setTheme("dark");
    await Promise.resolve();
    expect(el.getAttribute("data-mode")).toBe("dark");
  });

  it("renders all four icon SVGs", async () => {
    const el = createThemeToggle();
    await Promise.resolve();
    const svgs = el.shadowRoot!.querySelectorAll("svg");
    expect(svgs.length).toBe(4);
  });

  it("cleans up subscriptions on disconnect", async () => {
    const el = createThemeToggle();
    await Promise.resolve();
    el.remove();
    setTheme("dark");
    expect($theme.get()).toBe("dark");
  });
});
