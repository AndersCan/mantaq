// @vitest-environment happy-dom
import type { VizDriver, VizLiveState, VizMachine } from "../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mountViewer } from "./embed.ts";

const machine: VizMachine = {
  id: "steps",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: ["idle", "paying"].map((id) => ({
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

function live(stepCount: number): VizLiveState {
  return {
    state: "idle",
    steps: Array.from({ length: stepCount }, () => ({
      kind: "event" as const,
      event: "submit",
      payload: null,
    })),
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

afterEach(() => {
  vi.restoreAllMocks();
});

function mountSteps() {
  let push: (state: VizLiveState) => void = () => undefined;
  const driver: VizDriver = {
    reset: () => live(0),
    step: () => live(0),
    listen: (callback) => {
      push = callback;
    },
  };
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    // A browser lays out nothing inside a hidden tab panel.
    if (this.closest("[hidden]") !== null) return { top: 0 } as DOMRect;
    const top = 100 * Number(this.getAttribute("data-step") ?? 1);
    return { top } as DOMRect;
  });
  const list = () => root.querySelector<HTMLElement>('[data-tab-panel="step"]')!;
  return { root, list, push };
}

test("a new step scrolls the newest step to the top of the step list", () => {
  const { list, push } = mountSteps();
  push(live(3));
  expect(list().scrollTop).toBe(200);
});

test("a refresh without a new step keeps the reader's scroll", () => {
  const { root, list, push } = mountSteps();
  push(live(1));
  list().scrollTop = 120;
  root.querySelector<HTMLElement>('[data-tab="step"]')!.click();
  expect(list().scrollTop).toBe(120);
});

test("steps taken on another tab show the newest step when the Step tab opens", () => {
  const { root, list, push } = mountSteps();
  root.querySelector<HTMLElement>('[data-tab="details"]')!.click();
  push(live(3));
  root.querySelector<HTMLElement>('[data-tab="step"]')!.click();
  expect(list().scrollTop).toBe(200);
});

test("back on the Step tab after selecting a state, the newest step shows", () => {
  const { root, list, push } = mountSteps();
  push(live(3));
  root
    .querySelector<HTMLElement>("[data-node-id]")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  root.querySelector<HTMLElement>('[data-tab="step"]')!.click();
  expect(list().scrollTop).toBe(200);
});
