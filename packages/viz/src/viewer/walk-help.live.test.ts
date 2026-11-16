// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { expect, test } from "vite-plus/test";
import { sendVia } from "./send-via.ts";

const state = (id: string, initial = false): VizState => ({
  id,
  label: id.slice(id.lastIndexOf(".") + 1),
  region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  initial,
  final: false,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

const worker = {
  name: "worker",
  type: "string",
  optional: false,
  doc: null,
  input: "text" as const,
  choices: [],
  sample: "sample",
};

const pool: VizMachine = {
  id: "inbox",
  initial: "busy",
  regions: [],
  maps: [],
  actors: [],
  states: [state("busy", true), state("idle")],
  events: [
    { id: "ITEM_ARRIVED", internal: false, doc: null, payload: null },
    { id: "ITEMS_FINISHED", internal: false, doc: null, payload: [worker] },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [
    {
      id: "busy-ITEMS_FINISHED-idle",
      from: "busy",
      event: "ITEMS_FINISHED",
      to: "idle",
      kind: "transition",
      origin: "declared",
      emits: [],
      contexts: [],
      coverage: null,
      tested: null,
      explanation: null,
      doc: null,
    },
    {
      id: "busy-ITEM_ARRIVED-busy",
      from: "busy",
      event: "ITEM_ARRIVED",
      to: "busy",
      kind: "stay",
      origin: "declared",
      emits: [],
      contexts: [],
      coverage: null,
      tested: null,
      explanation: null,
      doc: null,
    },
  ],
  runs: [],
  fuzz: null,
};

const step = (partial: Partial<VizLiveStep>): VizLiveStep => ({
  from: "busy",
  event: "ITEM_ARRIVED",
  to: "busy",
  outcome: "stay",
  effects: [],
  sent: [],
  context: { waiting: 0 },
  error: null,
  ...partial,
});

function live(steps: number, after: VizLiveStep[]): VizLiveState {
  return {
    state: "busy",
    regions: {},
    children: [],
    steps: Array.from({ length: steps }, () => ({
      kind: "event" as const,
      event: "ITEM_ARRIVED",
      payload: null,
    })),
    last: steps > 0 ? step({}) : null,
    after,
    timers: [],
    context: { waiting: 0 },
    payload: null,
    effectMode: "real",
    waiting: [],
  };
}

function mount(after: VizLiveStep[], sent: VizStep[] = []) {
  const root = document.createElement("div");
  let n = 0;
  const driver: VizDriver = {
    reset: () => live((n = 0), []),
    step: (each) => {
      sent.push(each);
      return live(++n, after);
    },
  };
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] }, { driver });
  return root;
}

test("a click sends what a part sent after the last step", () => {
  const assigned = step({
    event: "ITEMS_ASSIGNED",
    message: { sender: "", dropped: null, payload: { worker: "w1" } },
  });
  const sent: VizStep[] = [];
  const root = mount([assigned], sent);
  sendVia(root, "ITEM_ARRIVED");
  sendVia(root, "ITEMS_FINISHED");
  expect(sent.at(-1)).toMatchObject({ event: "ITEMS_FINISHED", payload: { worker: "w1" } });
});
