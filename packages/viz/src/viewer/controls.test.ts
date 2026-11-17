// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizMachine } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

const machine: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
  maps: [],
  actors: [],
  states: [
    {
      id: "open",
      label: "open",
      region: null,
      initial: true,
      final: false,
      effects: [],
      coverage: null,
      tested: null,
      doc: null,
    },
  ],
  events: [],
  outputs: [],
  context: null,
  edges: [
    {
      id: "init",
      from: "__initial__",
      event: "",
      to: "open",
      kind: "initial",
      origin: "declared",
      emits: [],
      contexts: [],
      explanation: null,
      doc: null,
      coverage: null,
      tested: null,
    },
  ],
  fuzz: null,
  runs: [],
  findings: [],
} as unknown as VizMachine;

function mount(options: { diagramOnly?: boolean } = {}): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, options);
  return root;
}

const tabIds = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-tab]")].map((tab) => tab.getAttribute("data-tab"));

describe("diagramOnly", () => {
  test("opens with only the canvas and Show controls", () => {
    const root = mount({ diagramOnly: true });
    expect(root.classList.contains("diagram-only")).toBe(true);
    expect(root.querySelector(".panel")).toBeNull();
    expect(root.querySelector(".canvas svg")).not.toBeNull();
    expect(root.querySelector("[data-show-controls]")?.textContent).toBe("Show controls");
  });

  test("Show controls brings the panel and the Details tab back, with focus on the tab", () => {
    const root = mount({ diagramOnly: true });
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.classList.contains("diagram-only")).toBe(false);
    expect(root.querySelector(".panel")).not.toBeNull();
    expect(root.querySelector("[data-show-controls]")).toBeNull();
    expect(tabIds(root)).toEqual(["details"]);
    const shown = root.querySelector('[role="tab"][aria-selected="true"]');
    expect(shown?.textContent).toBe("Details");
    expect(document.activeElement).toBe(shown);
  });

  test("Show controls after a click on the canvas still opens the Details tab", () => {
    const root = mount({ diagramOnly: true });
    root
      .querySelector('[data-node-id="open"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Details");
  });

  test("a mount without the option has no Show controls button and no Controls or Diagram only", () => {
    const root = mount();
    expect(root.querySelector("[data-show-controls]")).toBeNull();
    expect(root.querySelector("[data-diagram-only]")).toBeNull();
    expect(root.querySelector('[data-tab="controls"]')).toBeNull();
  });

  test("the Details tab with nothing selected says what to click", () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-tab="details"]')?.click();
    expect(root.querySelector('[data-tab-panel="details"]')?.textContent).toBe(
      "Click a state or an arrow in the diagram.",
    );
  });
});
