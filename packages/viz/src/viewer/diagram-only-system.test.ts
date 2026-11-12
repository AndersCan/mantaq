// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState } from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

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
const edge = (from: string, event: string, to: string, emits: string[] = []): VizEdge => ({
  id: `${from}-${event}-${to}`,
  from,
  event,
  to,
  kind: "transition",
  origin: "declared",
  emits,
  contexts: [],
  explanation: null,
  doc: null,
  coverage: null,
  tested: null,
});
const event = (id: string) => ({ id, internal: false, doc: null, payload: null });

/** A parent with a worker pool: the viewer opens it in the system view, whose event names share the prefix inbox.. */
const pool: VizMachine = {
  id: "teamInbox",
  initial: "empty",
  regions: ["workers"],
  maps: ["workers"],
  states: [
    state("empty", true),
    state("holding"),
    state("workers.free", true),
    state("workers.working"),
  ],
  events: [event("inbox.arrived"), event("inbox.assigned"), event("inbox.done")],
  outputs: ["inbox.assigned"],
  partOutputs: { workers: ["inbox.done"] },
  context: null,
  edges: [
    edge("empty", "inbox.arrived", "holding", ["inbox.assigned"]),
    edge("holding", "inbox.done", "empty"),
    edge("workers.free", "inbox.assigned", "workers.working", ["inbox.done"]),
  ],
  runs: [],
  fuzz: null,
} as unknown as VizMachine;

const snapshot = (): VizLiveState =>
  ({
    state: "empty",
    regions: {},
    children: [{ map: "workers", key: "w1", state: "workers.free", since: 0 }],
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    effectMode: "real",
    waiting: [],
  }) as unknown as VizLiveState;

describe("Diagram only in the system view", () => {
  for (const live of [false, true]) {
    test(`draws no key line under the diagram (driver: ${live})`, () => {
      const root = document.createElement("div");
      const driver: VizDriver = { reset: snapshot, step: snapshot };
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [pool] },
        live ? { driver, diagramOnly: true } : { diagramOnly: true },
      );
      expect(root.querySelector("[data-show-controls]")).not.toBeNull();
      expect(root.querySelector("[data-viz-key]")?.textContent ?? null).toBeNull();
    });
  }
});
