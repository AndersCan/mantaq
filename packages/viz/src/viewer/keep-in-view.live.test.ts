// @vitest-environment happy-dom
import type { VizDriver, VizLiveState, VizMachine } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { keepInView } from "./keep-in-view.ts";
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

interface PlacedOptions {
  left: number;
  width: number;
  canvas: HTMLElement;
}

/** Gives `element` a fixed box, `left` in content pixels of `canvas`, as a browser lays it out. */
function place(element: Element | null, options: PlacedOptions): void {
  const { left, width, canvas } = options;
  if (element === null) return;
  element.getBoundingClientRect = () => new DOMRect(left - canvas.scrollLeft, 0, width, 40);
}

test("the canvas scrolls to the arrows that leave the state it shows or any state, not to another state's", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="canvas"><svg class="graph">
    <g data-node-id="here"></g>
    <g class="edge next" role="button" data-from="here"><text>go</text></g>
    <g class="edge next" role="button" data-from="there"><text>stop</text></g>
    <g class="any-node" data-node-id="*"></g>
    <g class="edge next" role="button" data-from="*"><text>reset</text></g>
  </svg></div>`;
  document.body.append(root);
  const canvas = root.querySelector<HTMLElement>(".canvas") ?? root;
  Object.defineProperty(canvas, "clientWidth", { value: 300 });
  Object.defineProperty(canvas, "scrollWidth", { value: 6000 });
  place(canvas.querySelector('[data-node-id="here"]'), { left: 1000, width: 120, canvas });
  place(canvas.querySelector('[data-from="here"] text'), { left: 1130, width: 50, canvas });
  place(canvas.querySelector('[data-from="there"] text'), { left: 850, width: 50, canvas });
  place(canvas.querySelector('[data-from="*"] text'), { left: 1190, width: 50, canvas });
  keepInView(root, { node: "here", with: "sendable" });
  expect(canvas.scrollLeft).toBe(1190 + 50 + 16 - 300);
  root.remove();
});
