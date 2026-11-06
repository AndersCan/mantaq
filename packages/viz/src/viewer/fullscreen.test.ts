// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizMachine } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test, vi } from "vite-plus/test";

const machine: VizMachine = {
  id: "door",
  initial: "open",
  regions: [],
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

function mount(): HTMLElement {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
  return root;
}

function allowFullscreen(root: HTMLElement) {
  const request = vi.fn(() => Promise.resolve());
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(root, "requestFullscreen", { value: request, configurable: true });
  return request;
}

describe("fullscreen button", () => {
  test("is absent where the browser cannot fullscreen", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    expect(mount().querySelector(".fullscreen-toggle")).toBeNull();
  });

  test("requests fullscreen on the viewer root", () => {
    const root = document.createElement("div");
    const request = allowFullscreen(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    const button = root.querySelector<HTMLButtonElement>(".fullscreen-toggle");
    expect(button?.textContent).toBe("Full screen");
    button?.click();
    expect(request).toHaveBeenCalledOnce();
  });
});
