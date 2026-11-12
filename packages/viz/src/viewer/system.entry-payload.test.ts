// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
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

const lanes: VizMachine = {
  id: "teamInbox",
  initial: "empty",
  regions: ["workers", "net"],
  maps: ["workers"],
  states: [
    state("empty", true),
    state("holding"),
    state("workers.free", true),
    state("workers.working"),
    state("net.up", true),
    state("net.down"),
  ],
  events: [
    event("ITEM_ARRIVED"),
    event("ITEMS_ASSIGNED"),
    event("WORK_DONE"),
    event("FINISH"),
    {
      id: "DROP",
      internal: false,
      doc: null,
      payload: [
        {
          name: "reason",
          type: "string",
          optional: false,
          doc: null,
          input: "text",
          choices: [],
          sample: "offline",
        },
      ],
    },
    event("RESTORE"),
  ],
  outputs: ["ITEMS_ASSIGNED", "LOST"],
  partOutputs: { workers: ["WORK_DONE"] },
  context: null,
  edges: [
    edge("empty", "ITEM_ARRIVED", "holding", ["ITEMS_ASSIGNED"]),
    edge("holding", "WORK_DONE", "empty"),
    edge("workers.free", "ITEMS_ASSIGNED", "workers.working", ["WORK_DONE"]),
    edge("workers.working", "FINISH", "workers.free"),
    edge("net.up", "DROP", "net.down"),
    edge("net.down", "RESTORE", "net.up"),
  ],
  runs: [],
  fuzz: null,
};

const snapshot = (steps: VizStep[]): VizLiveState => ({
  state: "empty",
  regions: { net: steps.length === 0 ? "net.up" : "net.down" },
  children: ["w1", "w2"].map((key) => ({ map: "workers", key, state: "workers.free", since: 0 })),
  steps,
  last: null,
  after: [],
  timers: [],
  context: null,
  payload: null,
  effectMode: "real",
  waiting: [],
});

describe("system view entry line on an event with data", () => {
  test("opens the form, sends nothing, and Send reaches the region", () => {
    const steps: VizStep[] = [];
    const driver: VizDriver = {
      reset: () => snapshot([]),
      step: (step) => {
        steps.push(step);
        return snapshot([...steps]);
      },
    };
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [lanes] }, { driver });
    expect(root.querySelector("svg[data-system]")).not.toBeNull();
    root.querySelector('[data-entry-event="DROP"]')?.dispatchEvent(new Event("click"));
    expect(steps).toEqual([]);
    expect(
      root.querySelector<HTMLInputElement>('.payload-sheet [data-payload-form="DROP"] input')
        ?.value,
    ).toBe("offline");
    root.querySelector<HTMLButtonElement>('[data-payload-send="DROP"]')?.click();
    expect(steps).toEqual([
      { kind: "event", event: "DROP", payload: { reason: "offline" }, actor: { region: "net" } },
    ]);
  });
  test("after Escape or Send from an entry line's form, focus is back on that entry line", () => {
    const steps: VizStep[] = [];
    const driver: VizDriver = {
      reset: () => snapshot([]),
      step: (step) => {
        steps.push(step);
        return snapshot([...steps]);
      },
    };
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [lanes] }, { driver });
    const line = () => root.querySelector<SVGGElement>('[data-entry-event="DROP"]');
    line()?.focus();
    line()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement?.closest(".payload-sheet")).not.toBeNull();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector(".payload-sheet")).toBeNull();
    expect(document.activeElement?.getAttribute("data-entry-event")).toBe("DROP");
    line()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-payload-send="DROP"]')?.click();
    expect(steps).toHaveLength(1);
    expect(document.activeElement?.getAttribute("data-entry-event")).toBe("DROP");
    root.remove();
  });
});

describe("edge form focus", () => {
  test("Escape gives focus back to the arrow the form came from, not the first arrow", () => {
    const flat: VizMachine = {
      ...lanes,
      id: "door",
      initial: "shut",
      regions: [],
      maps: [],
      states: [state("shut", true), state("open")],
      events: [event("PEEK"), lanes.events.find((each) => each.id === "DROP")!],
      outputs: [],
      partOutputs: {},
      edges: [edge("shut", "PEEK", "shut"), edge("shut", "DROP", "open")],
    };
    const live = (steps: VizStep[]): VizLiveState => ({
      ...snapshot(steps),
      state: steps.length === 0 ? "shut" : "open",
      regions: {},
      children: [],
    });
    const driver: VizDriver = { reset: () => live([]), step: (step) => live([step]) };
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [flat] }, { driver });
    const arrow = root.querySelector<SVGGElement>('[data-edge-id="shut-DROP-open"]');
    arrow?.focus();
    arrow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement?.closest(".payload-sheet")).not.toBeNull();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.activeElement?.getAttribute("data-edge-id")).toBe("shut-DROP-open");
    root.remove();
  });
});
