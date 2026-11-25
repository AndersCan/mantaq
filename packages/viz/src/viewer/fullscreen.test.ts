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
  partOutputs: {},
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
};

function mount(options: { diagramOnly?: boolean } = {}): HTMLElement {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, options);
  return root;
}

function allowFullscreen(root: HTMLElement, request = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(root, "requestFullscreen", { value: request, configurable: true });
  return request;
}

function setFullscreenElement(value: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", { value, configurable: true });
}

function mountFullscreen(
  request = vi.fn(() => Promise.resolve()),
  options: { diagramOnly?: boolean } = {},
) {
  const root = document.createElement("div");
  allowFullscreen(root, request);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, options);
  const button = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
  return { root, request, button };
}

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
});

describe("fullscreen button", () => {
  test("is absent where the browser cannot fullscreen", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    expect(mount().querySelector(".fullscreen-toggle")).toBeNull();
  });

  test("is absent when requestFullscreen is missing", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
    const root = document.createElement("div");
    Object.defineProperty(root, "requestFullscreen", { value: undefined, configurable: true });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    expect(root.querySelector(".fullscreen-toggle")).toBeNull();
  });

  test("requests fullscreen on the viewer root", () => {
    const { button, request } = mountFullscreen();
    expect(button?.textContent).toBe("Full screen");
    button?.click();
    expect(request).toHaveBeenCalledOnce();
  });

  test("label and aria-pressed follow fullscreenchange both ways", () => {
    const { root, button } = mountFullscreen();
    setFullscreenElement(root);
    root.dispatchEvent(new Event("fullscreenchange"));
    expect(button?.textContent).toBe("Exit full screen");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    setFullscreenElement(null);
    root.dispatchEvent(new Event("fullscreenchange"));
    expect(button?.textContent).toBe("Full screen");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
  });

  test("click while fullscreen exits instead of requesting", () => {
    const { root, button, request } = mountFullscreen();
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    setFullscreenElement(root);
    root.dispatchEvent(new Event("fullscreenchange"));
    button?.click();
    expect(exit).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  test("a rejected request is swallowed", async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error("denied")));
    const { button } = mountFullscreen(rejecting);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(rejecting).toHaveBeenCalledOnce();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

/** The class of each element in the bar above the canvas. */
function barOf(root: HTMLElement): string[] {
  const names: string[] = [];
  for (const child of root.querySelector(".viz-bar")?.children ?? []) names.push(child.className);
  return names;
}

describe("fullscreen placement", () => {
  test("the button sits in the bar above the diagram", () => {
    const { root, button } = mountFullscreen();
    expect(button?.parentElement?.classList.contains("viz-bar")).toBe(true);
    expect(root.firstElementChild).toBe(button?.parentElement);
  });

  test("diagram only: the bar holds the zoom and pan tools, Show controls, then Full screen", () => {
    const { root } = mountFullscreen(undefined, { diagramOnly: true });
    expect(barOf(root)).toEqual(["viz-tools", "show-controls", "fullscreen-toggle"]);
  });

  test("diagram only without full screen: the bar holds the tools and Show controls", () => {
    expect(barOf(mount({ diagramOnly: true }))).toEqual(["viz-tools", "show-controls"]);
  });

  test("the full viewer without full screen: the bar holds the tools alone", () => {
    expect(barOf(mount())).toEqual(["viz-tools"]);
  });

  test("the label still follows after a re-render", () => {
    const { root } = mountFullscreen(undefined, { diagramOnly: true });
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    const button = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
    setFullscreenElement(root);
    root.dispatchEvent(new Event("fullscreenchange"));
    expect(button?.textContent).toBe("Exit full screen");
  });
});

describe("fullscreen state at render", () => {
  test("Show controls pressed in full screen draws Exit full screen", () => {
    const root = document.createElement("div");
    allowFullscreen(root);
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { diagramOnly: true },
    );
    setFullscreenElement(root);
    root.dispatchEvent(new Event("fullscreenchange"));
    root.querySelector<HTMLButtonElement>("[data-show-controls]")?.click();
    const button = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
    expect(button?.textContent).toBe("Exit full screen");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });

  test("the bar sits above the run notice", () => {
    const root = document.createElement("div");
    allowFullscreen(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { run: "nope" });
    expect([...root.children].map((child) => child.className)).toEqual([
      "viz-bar",
      "run-notice",
      "viz-main",
    ]);
  });
});
