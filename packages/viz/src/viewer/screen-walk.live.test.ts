// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

const ids = ["idle", "a", "b", "c", "d"];
const state = (id: string): VizState => ({
  id,
  label: id,
  region: null,
  initial: id === "idle",
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});
const edge = (from: string, to: string): VizEdge => ({
  id: `${from}-go-${to}`,
  from,
  event: "go",
  to,
  kind: "transition",
  origin: "declared",
  emits: [],
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});
const fuzzGo: VizStep = { kind: "event", event: "go", payload: null };
const chain: VizMachine = {
  id: "chain",
  initial: "idle",
  regions: [],
  maps: [],
  states: ids.map(state),
  events: [
    { id: "go", internal: false, doc: null, payload: null },
    { id: "tick", internal: false, doc: null, payload: null },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    ...ids.slice(0, -1).map((from, i) => edge(from, ids[i + 1] ?? from)),
    { ...edge("c", "c"), id: "c-tick-c", event: "tick" },
  ],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [
      { steps: [fuzzGo, fuzzGo, fuzzGo, fuzzGo], discovered: ["state:a", "state:b", "state:c"] },
    ],
    errors: [],
    failedExpectations: [],
    expectations: [],
  },
};
let lie = false;
function driver(): VizDriver {
  const done: VizStep[] = [];
  const run = (): VizLiveState => ({
    state:
      ids[
        Math.min(
          done.filter((s) => s.kind === "event" && s.event === "go").length -
            (lie && done.length > 1 ? 2 : 0),
          ids.length - 1,
        )
      ] ?? "idle",
    steps: [...done],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    regions: {},
    children: [],
    effectMode: "real",
    waiting: [],
  });
  return {
    reset: () => {
      done.length = 0;
      return run();
    },
    step: (step) => {
      done.push(step);
      return run();
    },
  };
}
function mount(onNavigate?: (w: { steps: string[] }) => void) {
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [chain] },
    {
      driver: driver(),
      screen: (live) =>
        Object.assign(document.createElement("p"), {
          className: "drawn",
          textContent: `screen of ${live.state}`,
        }),
      ...(onNavigate === undefined ? {} : { onNavigate }),
    },
  );
  return root;
}
const clickState = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-node-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

describe("Screen walk", () => {
  test("a step after clicking the initial state starts from the initial state", () => {
    const root = mount();
    clickState(root, "c");
    expect(current(root)).toBe("c");
    clickState(root, "idle"); // the initial state: walk of zero steps, driver back at idle
    clickState(root, "a"); // the next state of idle
    expect(current(root)).toBe("a");
  });

  test("clicking the initial state with Screen open shows the initial screen", () => {
    const root = mount();
    clickState(root, "c");
    clickState(root, "idle");
    expect(current(root)).toBe("idle");
  });

  test("clicking the cursor's own state keeps the walk it took", () => {
    const navigated: string[][] = [];
    const root = mount((w) => navigated.push(w.steps));
    clickState(root, "c");
    [...root.querySelectorAll("button")].find((b) => b.textContent === "tick")?.click();
    clickState(root, "c");
    expect(navigated.at(-1)).toEqual(["go", "go", "go", "tick"]);
  });

  test("without a driver, a click on a far state opens its details", () => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [chain] },
      {
        screen: () => document.createElement("p"),
      },
    );
    clickState(root, "c");
    expect(root.querySelector("[data-tab-panel=details]")?.hasAttribute("hidden")).toBe(false);
  });

  test("a walk that never lands leaves the driver on the shown state", () => {
    const root = mount();
    clickState(root, "a");
    lie = true; // the driver now lags one step, so the walk to c never lands there
    clickState(root, "c");
    lie = false;
    expect(current(root)).toBe("a");
    clickState(root, "b");
    expect(current(root)).toBe("b");
  });
});
