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

const pool: VizMachine = {
  id: "teamInbox",
  initial: "empty",
  regions: ["workers"],
  maps: ["workers"],
  actors: [],
  states: [
    state("empty", true),
    state("holding"),
    { ...state("done"), final: true },
    state("workers.free", true),
    state("workers.working"),
  ],
  events: [event("ITEM_ARRIVED"), event("ITEMS_ASSIGNED"), event("WORK_DONE"), event("FINISH")],
  outputs: ["ITEMS_ASSIGNED", "LOST"],
  partOutputs: { workers: ["WORK_DONE"] },
  context: null,
  edges: [
    edge("empty", "ITEM_ARRIVED", "holding", ["ITEMS_ASSIGNED"]),
    edge("holding", "WORK_DONE", "done"),
    edge("workers.free", "ITEMS_ASSIGNED", "workers.working", ["WORK_DONE"]),
    edge("workers.working", "FINISH", "workers.free"),
  ],
  runs: [],
  fuzz: null,
};

function live(current: string): VizLiveState {
  return {
    state: current,
    regions: {},
    children: [],
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: null,
    payload: null,
    effectMode: "real",
    waiting: [],
  };
}

function mount(machine: VizMachine, withDriver = true) {
  const root = document.createElement("div");
  let current = "empty";
  const driver: VizDriver = {
    reset: () => live((current = "empty")),
    step: (step) => {
      current = step.kind === "event" && step.event === "ITEM_ARRIVED" ? "holding" : "done";
      return live(current);
    },
  };
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
    withDriver ? { driver } : {},
  );
  return root;
}

const entry = (root: HTMLElement) => root.querySelector("g.link-in");
const isNext = (root: HTMLElement) => entry(root)?.querySelector(".next") !== null;

describe("system view entry arrow", () => {
  test("moves while the current state handles the entry event", () => {
    expect(isNext(mount(pool))).toBe(true);
  });

  test("stops moving after a step to a state that does not handle it", () => {
    const root = mount(pool);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(isNext(root)).toBe(false);
  });

  test("an any-state edge counts", () => {
    const anyPool: VizMachine = {
      ...pool,
      edges: pool.edges.map((each) =>
        each.event === "ITEM_ARRIVED" ? { ...each, id: "any", from: "*" } : each,
      ),
    };
    const root = mount(anyPool);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    expect(isNext(root)).toBe(true);
  });

  test("without a driver nothing moves", () => {
    expect(isNext(mount(pool, false))).toBe(false);
  });

  test("a final current state gives no movement", () => {
    const finalPool: VizMachine = {
      ...pool,
      edges: [...pool.edges, edge("done", "ITEM_ARRIVED", "holding")],
    };
    const root = mount(finalPool);
    root.querySelector<HTMLButtonElement>('[data-send="ITEM_ARRIVED"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-send="WORK_DONE"]')?.click();
    expect(isNext(root)).toBe(false);
  });
});
