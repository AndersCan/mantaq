// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizLiveState, VizLiveStep, VizMachine, VizStep } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { expect, test } from "vite-plus/test";

/** One plate: `take` (cart → cart) works once, then its guard (items !== 1) refuses it. */
const machine: VizMachine = {
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
  events: [{ id: "take", internal: false, doc: null, payload: null }],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    {
      id: "cart-take-cart",
      from: "cart",
      event: "take",
      to: "cart",
      kind: "transition",
      origin: "declared",
      emits: [],
      contexts: [],
      explanation: {
        status: "analyzed",
        location: { file: "order.ts", line: 1, column: 1 },
        registration: "on",
        branches: [],
        payloadReads: [],
        contextReads: ["items"],
        contextWrites: [],
        readsActorState: false,
        comparisons: [{ source: "context", path: "items", operator: "!==", literal: 1 }],
        literals: [],
      },
      doc: null,
      coverage: null,
      tested: null,
    },
  ],
  runs: [],
  fuzz: null,
};

function driverOf() {
  const sent: VizStep[] = [];
  const run = (steps: ReadonlyArray<VizStep>) => {
    let items = 0;
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      if (step.kind !== "event") continue;
      const took = items !== 1;
      if (took) items += 1;
      last = {
        from: "cart",
        event: "take",
        to: "cart",
        outcome: took ? "transition" : "stay",
        effects: [],
        sent: [],
        context: { items },
        error: null,
      };
    }
    const live: VizLiveState = {
      state: "cart",
      steps: [...steps],
      last,
      after: [],
      timers: [],
      context: { items },
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
    };
    return { live, last };
  };
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return run([]).live;
    },
    step: (step) => {
      sent.push(step);
      return run(sent).live;
    },
    listen: () => undefined,
    dryRun: (candidates) => candidates.map((c) => run([...sent, c]).last),
  };
  return { driver, sent };
}

const click = (root: HTMLElement) =>
  root
    .querySelector('g.edge[data-edge-id="cart-take-cart"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const line = (root: HTMLElement) => root.querySelector(".viz-main > .blocked-note")?.textContent;

test("after a send blocks the arrow, the line says why and a second click sends nothing", () => {
  const { driver, sent } = driverOf();
  const root = document.createElement("div");
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    { driver, diagramOnly: true },
  );
  click(root);
  const first = { sent: sent.length, line: line(root) };
  click(root);
  expect({ first, second: { sent: sent.length, line: line(root) } }).toEqual({
    first: { sent: 1, line: "take is blocked: items is 1" },
    second: { sent: 1, line: "take is blocked: items is 1" },
  });
});

test("controls shown: Details says why the arrow, now blocked, sends nothing", () => {
  const { driver, sent } = driverOf();
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  click(root);
  click(root);
  expect({
    sent: sent.length,
    note: root.querySelector("[data-blocked-note]")?.textContent,
  }).toEqual({ sent: 1, note: "take is blocked: items is 1" });
});
