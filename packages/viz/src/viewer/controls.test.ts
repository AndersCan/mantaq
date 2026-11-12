// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizMachine } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const machine: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
  maps: [],
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

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenEnabled");
});

function mount(options: { diagramOnly?: boolean } = {}, shown: VizMachine = machine): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shown] }, options);
  return root;
}

/** An orphan state nothing reaches is a finding; the open state has an effect with no declared sends. */
function withFinding(): VizMachine {
  const copy = structuredClone(machine);
  const [open] = copy.states;
  if (open === undefined) throw new Error("fixture has no state");
  copy.states = [
    { ...open, effects: [{ name: "ring", sends: null }] },
    { ...open, id: "orphan", label: "orphan", initial: false },
  ] as unknown as VizMachine["states"];
  return copy;
}

const tabNames = (root: HTMLElement) =>
  [...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

describe("Controls tab", () => {
  test("is the last tab and holds Full screen and Diagram only, not the header", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
    const root = document.createElement("div");
    Object.defineProperty(root, "requestFullscreen", { value: vi.fn(), configurable: true });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    expect(tabNames(root).at(-1)).toBe("Controls");
    const panel = root.querySelector('[data-tab-panel="controls"]');
    expect(panel?.querySelector(".fullscreen-toggle")?.textContent).toBe("Full screen");
    expect(panel?.querySelector("[data-diagram-only]")?.textContent).toBe("Diagram only");
    expect(root.querySelector(".viz-header .fullscreen-toggle")).toBeNull();
  });

  test("omits Full screen where the browser cannot", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    const panel = mount().querySelector('[data-tab-panel="controls"]');
    expect(panel?.querySelector(".fullscreen-toggle")).toBeNull();
    expect(panel?.querySelector("[data-diagram-only]")).not.toBeNull();
  });
});

describe("Diagram only", () => {
  test("shows only the canvas and Show controls", () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    expect(root.classList.contains("diagram-only")).toBe(true);
    expect(root.querySelector(".viz-header")).toBeNull();
    expect(root.querySelector(".tabs")).toBeNull();
    expect(root.querySelector(".panel")).toBeNull();
    expect(root.querySelector(".canvas svg")).not.toBeNull();
    expect(root.querySelector("[data-show-controls]")?.textContent).toBe("Show controls");
    expect(document.activeElement).toBe(root.querySelector("[data-show-controls]"));
  });

  test("Show controls brings the header and tabs back", () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.classList.contains("diagram-only")).toBe(false);
    expect(root.querySelector(".viz-header")).not.toBeNull();
    expect(tabNames(root).at(-1)).toBe("Controls");
    expect(root.querySelector("[data-show-controls]")).toBeNull();
    expect(document.activeElement).toBe(root.querySelector("[data-diagram-only]"));
  });

  test("a new mount starts with the controls shown", () => {
    mount().querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    expect(mount().querySelector(".viz-header")).not.toBeNull();
  });

  test("the diagramOnly option opens with only the canvas, and Show controls still works", () => {
    const root = mount({ diagramOnly: true });
    expect(root.classList.contains("diagram-only")).toBe(true);
    expect(root.querySelector(".panel")).toBeNull();
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.querySelector(".viz-header")).not.toBeNull();
  });

  test("Diagram only on a machine with a finding draws the diagram and Show controls, nothing else", () => {
    const root = mount({ diagramOnly: true }, withFinding());
    expect(root.querySelector(".finding-mark")).toBeNull();
    expect(root.querySelector(".panel")).toBeNull();
    expect(root.querySelector(".viz-header")).toBeNull();
    expect(root.querySelector(".hint")).toBeNull();
    const texts = [...root.querySelectorAll("button, svg text")].map((node) => node.textContent);
    expect(texts).toEqual(["Show controls", "open", "ring", "orphan"]);
    expect(root.textContent).toBe(`Show controls${["open", "ring", "orphan"].join("")}`);
  });

  test("Show controls brings the finding mark and the panel back", () => {
    const root = mount({ diagramOnly: true }, withFinding());
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.querySelector(".finding-mark")).not.toBeNull();
    expect(root.querySelector(".hint")).not.toBeNull();
    expect(root.querySelector(".panel")).not.toBeNull();
    expect(root.querySelector(".viz-header")).not.toBeNull();
  });

  test("with the diagramOnly option, Show controls opens the Step tab", () => {
    const root = mount({ diagramOnly: true });
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    const shown = root.querySelector('[role="tab"][aria-selected="true"]');
    expect(shown?.textContent).toBe("Step");
  });

  test("with the diagramOnly option, Show controls leaves focus on a shown control", () => {
    const root = mount({ diagramOnly: true });
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.closest("[hidden]")).toBeNull();
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
  });

  test("with diagramOnly: false, Show controls opens the Controls tab", () => {
    const root = mount({ diagramOnly: false });
    root.querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    const shown = root.querySelector('[role="tab"][aria-selected="true"]');
    expect(shown?.textContent).toBe("Controls");
    expect(document.activeElement?.hasAttribute("data-diagram-only")).toBe(true);
  });

  test("without the option, Show controls focuses the Diagram only button", () => {
    const root = mount({});
    root.querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    expect(document.activeElement?.hasAttribute("data-diagram-only")).toBe(true);
  });
});

describe("Diagram only, after a canvas click", () => {
  test("Show controls returns to the Controls tab with focus on Diagram only", () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>("[data-diagram-only]")?.click();
    root
      .querySelector('[data-node-id="open"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    const shown = root.querySelector('[role="tab"][aria-selected="true"]');
    expect(shown?.textContent).toBe("Controls");
    expect(document.activeElement).toBe(root.querySelector("[data-diagram-only]"));
    expect(document.activeElement?.closest("[hidden]")).toBeNull();
  });
});

describe("Coverage from picker", () => {
  const fresh = (): VizMachine => structuredClone(machine);
  const covered = (): VizMachine => {
    const copy = fresh();
    copy.states = copy.states.map((state) => ({ ...state, coverage: { hits: 1 } }));
    return copy;
  };

  test("is in the Controls tab, not the header, when a mode has data", () => {
    const root = mount({}, covered());
    expect(root.querySelector('[data-tab-panel="controls"] .coverage-mode')).not.toBeNull();
    expect(root.querySelector(".viz-header .coverage-mode")).toBeNull();
    expect(root.querySelector(".viz-header")?.textContent).toContain("Viz: door");
  });

  test("is absent everywhere without coverage data", () => {
    const root = mount({}, fresh());
    expect(root.querySelector(".coverage-mode")).toBeNull();
  });
});

describe("Coverage from picker, order", () => {
  test("is the first item in the Controls tab", () => {
    const shown = structuredClone(machine);
    shown.states = shown.states.map((state) => ({ ...state, coverage: { hits: 1 } }));
    const root = mount({}, shown);
    const first = root.querySelector('[data-tab-panel="controls"] .controls')?.firstElementChild;
    expect(first?.querySelector(".coverage-mode")).not.toBeNull();
  });
});
