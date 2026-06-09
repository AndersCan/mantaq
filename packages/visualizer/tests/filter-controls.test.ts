// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vite-plus/test";
import "../src/components/filter-controls.ts";
import { $filterStatus } from "../src/graph-store.ts";
import type { FilterControls } from "../src/components/filter-controls.ts";

function createFilterControls(): FilterControls {
  const el = document.createElement("filter-controls") as FilterControls;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  $filterStatus.set("all");
});

describe("FilterControls component", () => {
  it("registers as custom element", () => {
    const el = document.createElement("filter-controls");
    expect(el).toBeDefined();
    expect(el.tagName.toLowerCase()).toBe("filter-controls");
  });

  it("has shadow root", () => {
    const el = createFilterControls();
    expect(el.shadowRoot).toBeDefined();
  });

  it("renders filter buttons", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    expect(buttons.length).toBe(4);
  });

  it("has all, active, final, inactive buttons", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const labels = Array.from(buttons).map((b) => b.textContent!.trim());
    expect(labels).toContain("all");
    expect(labels).toContain("active");
    expect(labels).toContain("final");
    expect(labels).toContain("inactive");
  });

  it("all button is active by default", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const allBtn = el.shadowRoot!.querySelector(".filter-btn.active");
    expect(allBtn).toBeDefined();
    expect(allBtn!.textContent!.trim()).toBe("all");
  });

  it("clicking active button sets filter", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "active",
    ) as HTMLButtonElement;
    activeBtn.click();
    await Promise.resolve();
    expect($filterStatus.get()).toBe("active");
  });

  it("clicking final button sets filter", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const finalBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "final",
    ) as HTMLButtonElement;
    finalBtn.click();
    await Promise.resolve();
    expect($filterStatus.get()).toBe("final");
  });

  it("clicking inactive button sets filter", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const inactiveBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "inactive",
    ) as HTMLButtonElement;
    inactiveBtn.click();
    await Promise.resolve();
    expect($filterStatus.get()).toBe("inactive");
  });

  it("clicking all button resets filter", async () => {
    $filterStatus.set("active");
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const allBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "all",
    ) as HTMLButtonElement;
    allBtn.click();
    await Promise.resolve();
    expect($filterStatus.get()).toBe("all");
  });

  it("has correct aria attributes", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const group = el.shadowRoot!.querySelector("[role='group']");
    expect(group).toBeDefined();
    expect(group!.getAttribute("aria-label")).toContain("Filter");
  });

  it("active button has aria-pressed true", async () => {
    $filterStatus.set("active");
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "active",
    ) as HTMLButtonElement;
    expect(activeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("inactive button has aria-pressed false when not selected", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const inactiveBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "inactive",
    ) as HTMLButtonElement;
    expect(inactiveBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("active button has active class when selected", async () => {
    $filterStatus.set("active");
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "active",
    ) as HTMLButtonElement;
    expect(activeBtn.classList.contains("active")).toBe(true);
  });

  it("non-selected button has no active class", async () => {
    $filterStatus.set("all");
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "active",
    ) as HTMLButtonElement;
    expect(activeBtn.classList.contains("active")).toBe(false);
  });

  it("clicking same filter twice keeps it active", async () => {
    $filterStatus.set("active");
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const activeBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "active",
    ) as HTMLButtonElement;
    activeBtn.click();
    await Promise.resolve();
    expect($filterStatus.get()).toBe("active");
  });

  it("updates UI when filter changes externally", async () => {
    $filterStatus.set("all");
    const el = createFilterControls();
    await Promise.resolve();
    $filterStatus.set("final");
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    const finalBtn = Array.from(buttons).find(
      (b) => b.textContent!.trim() === "final",
    ) as HTMLButtonElement;
    expect(finalBtn.classList.contains("active")).toBe(true);
  });

  it("all buttons have aria-pressed attribute", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    const buttons = el.shadowRoot!.querySelectorAll(".filter-btn");
    for (const btn of buttons) {
      expect(btn.hasAttribute("aria-pressed")).toBe(true);
    }
  });

  it("cleans up on disconnect", async () => {
    const el = createFilterControls();
    await Promise.resolve();
    el.remove();
    $filterStatus.set("active");
    expect($filterStatus.get()).toBe("active");
  });
});
