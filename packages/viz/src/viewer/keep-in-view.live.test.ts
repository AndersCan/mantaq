// @vitest-environment happy-dom
import type { VizDriver, VizLiveState, VizMachine } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mountViewer } from "./embed.ts";

// A 6000px-wide diagram in a 300px box; state boxes sit at these x offsets.
const at: Record<string, number> = { idle: 0, paying: 1500, error: 3000 };

const machine: VizMachine = {
  id: "wide",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: ["idle", "paying", "error"].map((id) => ({
    id,
    label: id,
    region: null,
    initial: id === "idle",
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  })),
  events: [{ id: "submit", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [],
    errors: [],
    failedExpectations: [],
    expectations: [],
    messages: [],
  },
};

function live(state: string): VizLiveState {
  return {
    state,
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children: [],
    effectMode: "real",
    waiting: [],
  };
}

function stubGeometry(): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("canvas") ? 300 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("canvas") ? 6000 : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const id = this.getAttribute("data-node-id");
    const canvas = this.closest(".canvas");
    const x = id !== null && id in at ? at[id]! - (canvas?.scrollLeft ?? 0) : 0;
    const width = id !== null && id in at ? 120 : 0;
    return {
      left: x,
      right: x + width,
      top: 0,
      bottom: 40,
      width,
      height: 40,
      x,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function mountWide(start: string) {
  let push: (state: VizLiveState) => void = () => undefined;
  const driver: VizDriver = {
    reset: () => live(start),
    step: () => live(start),
    listen: (callback) => {
      push = callback;
    },
  };
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  const canvas = root.querySelector<HTMLElement>(".canvas")!;
  return { canvas, push };
}

test("a driver push scrolls to the new state, and leaves a hand scroll alone while it shows", () => {
  stubGeometry();
  const { canvas, push } = mountWide("idle");
  expect(canvas.scrollLeft).toBe(0);
  push(live("error"));
  expect(canvas.scrollLeft).toBe(3000 + 120 + 16 - 300);
  canvas.scrollLeft = 2900;
  push(live("error"));
  expect(canvas.scrollLeft).toBe(2900);
});

test("a resize that keeps the width leaves a hand scroll alone, and a new width shows the current state again", () => {
  stubGeometry();
  const { canvas } = mountWide("error");
  canvas.scrollLeft = 0;
  window.dispatchEvent(new Event("resize"));
  const sameWidth = canvas.scrollLeft;
  Object.defineProperty(canvas, "clientWidth", { value: 400, configurable: true });
  window.dispatchEvent(new Event("resize"));
  expect({ sameWidth, newWidth: canvas.scrollLeft }).toEqual({
    sameWidth: 0,
    newWidth: 3000 + 120 + 16 - 400,
  });
});
