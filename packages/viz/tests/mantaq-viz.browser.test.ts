import { describe, test, expect, afterEach } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { Actor, state, event } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import "../src/components/mantaq-viz.ts";

function createDemoActor(): AnyActor {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    setup: (m) => {
      m.on(idle, go, () => ({ state: active }));
    },
  });
}

function mountViz(actor: AnyActor): HTMLElement {
  const el = document.createElement("mantaq-viz");
  document.body.appendChild(el);
  (el as any).actor = actor;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MantaqViz browser", () => {
  test("custom element is registered", () => {
    expect(customElements.get("mantaq-viz")).toBeDefined();
  });

  test("renders SVG graph container", () => {
    const actor = createDemoActor();
    const el = mountViz(actor);

    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  test("displays current state in toolbar", () => {
    const actor = createDemoActor();
    const el = mountViz(actor);

    expect(el.textContent).toContain("Current:");
    expect(el.textContent).toContain("idle");
  });

  test("renders event buttons for available transitions", () => {
    const actor = createDemoActor();
    const el = mountViz(actor);

    const buttons = el.querySelectorAll<HTMLButtonElement>("#palette-root button");
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toContain("GO");
  });

  test("clicking event button transitions state", async () => {
    const actor = createDemoActor();
    const el = mountViz(actor);

    const buttons = el.querySelectorAll<HTMLButtonElement>("#palette-root button");
    const goBtn = Array.from(buttons).find((b) => b.textContent?.trim() === "GO");
    expect(goBtn).toBeDefined();
    await userEvent.click(goBtn!);

    expect(el.textContent).toContain("active");
  });

  test("settings gear toggles settings panel", async () => {
    const actor = createDemoActor();
    const el = mountViz(actor);

    const gear = el.querySelector<HTMLButtonElement>(".viz-gear");
    expect(gear).not.toBeNull();
    await userEvent.click(gear!);

    expect(el.textContent).toContain("Direction");
  });
});
