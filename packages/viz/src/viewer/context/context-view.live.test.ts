// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type { VizDriver, VizField, VizLiveState, VizMachine, VizStep } from "../../schema.ts";
import { mountViewer } from "../embed.ts";
import { VIZ_SCHEMA_VERSION } from "../../schema.ts";

const total: VizField = {
  name: "total",
  type: "number",
  optional: false,
  doc: "What the cart costs.",
  input: "number",
  choices: [],
  sample: 0,
};

const coupon: VizField = { ...total, name: "coupon", type: "string", optional: true, doc: null };

const cart: VizMachine = {
  id: "cart",
  initial: "cart",
  regions: [],
  maps: [],
  actors: [],
  states: [
    {
      id: "cart",
      label: "cart",
      region: null,
      initial: true,
      final: false,
      effects: [],
      coverage: null,
      tested: null,
      doc: null,
    },
  ],
  events: [{ id: "add", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: [total, coupon],
  edges: [
    {
      id: "cart-add-cart",
      from: "cart",
      event: "add",
      to: "cart",
      kind: "stay",
      origin: "declared",
      emits: [],
      contexts: [],
      explanation: null,
      doc: null,
      coverage: null,
      tested: null,
    },
  ],
  runs: [],
  fuzz: null,
};

function liveOf(steps: ReadonlyArray<VizStep>): VizLiveState {
  return {
    state: "cart",
    steps: [...steps],
    last: null,
    after: [],
    timers: [],
    context: { total: steps.length * 5, lines: [{ sku: "a" }] },
    payload: null,
    regions: {},
    children: [],
    effectMode: "held",
    waiting: [],
  };
}

function driverOf(): VizDriver {
  const sent: VizStep[] = [];
  return {
    reset: () => {
      sent.length = 0;
      return liveOf(sent);
    },
    step: (step) => {
      sent.push(step);
      return liveOf(sent);
    },
  };
}

interface MountOptions {
  driver?: VizDriver;
  machine?: VizMachine;
}

function mount(options: MountOptions): HTMLElement {
  const root = document.createElement("div");
  const machines = [options.machine ?? cart];
  const driver = options.driver === undefined ? {} : { driver: options.driver };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines }, driver);
  return root;
}

function rows(root: HTMLElement): Record<string, string> {
  const cells = root.querySelectorAll("[data-tab-panel='context'] [data-context-key]");
  return Object.fromEntries(
    [...cells].map((cell) => [cell.getAttribute("data-context-key") ?? "", cell.textContent]),
  );
}

describe("the Context tab", () => {
  test("while a driver runs, shows the live context read only and follows each step", () => {
    const root = mount({ driver: driverOf() });
    const before = rows(root);
    root
      .querySelector('g.edge[data-edge-id="cart-add-cart"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect({
      before,
      after: rows(root),
      boxes: root.querySelectorAll("[data-tab-panel='context'] input").length,
      kind: root.querySelector("[data-context]")?.getAttribute("data-context"),
    }).toEqual({
      before: { total: "0", coupon: "not set", lines: '[{"sku":"a"}]' },
      after: { total: "5", coupon: "not set", lines: '[{"sku":"a"}]' },
      boxes: 0,
      kind: "live",
    });
  });

  test("without a driver, lists the fields the machine declares, and Details stays the open tab", () => {
    const root = mount({});
    expect({
      labels: [...root.querySelectorAll("[data-tab]")].map((tab) => tab.textContent),
      open: root.querySelector('[data-tab][aria-selected="true"]')?.textContent,
      rows: rows(root),
      kind: root.querySelector("[data-context]")?.getAttribute("data-context"),
    }).toEqual({
      labels: ["Context", "Details"],
      open: "Details",
      rows: { total: "numberWhat the cart costs.", coupon: "string (optional)" },
      kind: "declared",
    });
  });

  test("is left out when there is no context to show", () => {
    const root = mount({ machine: { ...cart, context: null } });
    const labels = [...root.querySelectorAll("[data-tab]")].map((tab) => tab.textContent);
    expect(labels).toEqual(["Details"]);
  });
});
