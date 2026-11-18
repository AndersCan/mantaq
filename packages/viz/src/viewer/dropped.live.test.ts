// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";
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

const kitchen: VizMachine = {
  id: "kitchen",
  initial: "cooking",
  regions: ["waiter"],
  maps: [],
  actors: [],
  states: [
    state("cooking", true),
    state("waiter.serving", true),
    state("waiter.carryingDish"),
    state("waiter.onBreak"),
  ],
  events: [event("DISH_COOKED"), event("DISH_READY"), event("DISH_SERVED"), event("BREAK_STARTED")],
  outputs: ["DISH_READY"],
  partOutputs: {},
  context: null,
  edges: [
    edge("cooking", "DISH_COOKED", "cooking", ["DISH_READY"]),
    edge("waiter.serving", "DISH_READY", "waiter.carryingDish"),
    edge("waiter.carryingDish", "DISH_SERVED", "waiter.serving"),
    edge("waiter.serving", "BREAK_STARTED", "waiter.onBreak"),
  ],
  runs: [],
  fuzz: null,
};

const entry = (partial: Partial<VizLiveStep>): VizLiveStep => ({
  from: "cooking",
  event: "DISH_COOKED",
  to: "cooking",
  outcome: "stay",
  effects: [],
  sent: [],
  context: null,
  error: null,
  ...partial,
});

const taken = entry({
  from: "waiter.serving",
  event: "DISH_READY",
  to: "waiter.carryingDish",
  outcome: "transition",
  actor: { region: "waiter" },
  message: { sender: "", dropped: null },
});

const dropped = (sender: string | null) =>
  entry({
    from: "waiter.onBreak",
    event: "DISH_READY",
    to: "waiter.onBreak",
    outcome: "ignored",
    actor: { region: "waiter" },
    message: { sender, dropped: "noHandler" },
  });

/** The recorded run: cook (taken), then the waiter's own step, then cook with the waiter on a break (dropped). */
function recorded(sender: string | null): Array<{ last: VizLiveStep; after: VizLiveStep[] }> {
  return [
    { last: entry({}), after: [taken] },
    {
      last: entry({ event: "DISH_SERVED", from: "waiter.carryingDish", to: "waiter.serving" }),
      after: [],
    },
    {
      last: entry({ event: "BREAK_STARTED", from: "waiter.serving", to: "waiter.onBreak" }),
      after: [],
    },
    { last: entry({}), after: [dropped(sender)] },
    { last: entry({}), after: [] },
  ];
}

function mount(sender: string | null = "") {
  const run = recorded(sender);
  const steps: VizStep[] = [];
  const snapshot = (): VizLiveState => {
    const at = run[steps.length - 1];
    return {
      state: "cooking",
      regions: { waiter: "waiter.serving" },
      children: [],
      steps: [...steps],
      last: at?.last ?? null,
      after: at?.after ?? [],
      timers: [],
      context: null,
      payload: null,
      effectMode: "real",
      waiting: [],
    };
  };
  const driver: VizDriver = {
    reset: () => {
      steps.length = 0;
      return snapshot();
    },
    step: (step) => {
      steps.push(step);
      return snapshot();
    },
  };
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [kitchen] }, { driver });
  return { root };
}

const send = sendVia;
const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent;

/** Walks the recorded run through the arrows, up to and including step `count`. */
function walk(root: HTMLElement, count: number) {
  const names = ["DISH_COOKED", "BREAK_STARTED", "BREAK_STARTED", "DISH_COOKED", "DISH_COOKED"];
  for (const name of names.slice(0, count)) send(root, name);
}

describe("dropped message", () => {
  test("a taken message names sender → receiver on the Step tab", () => {
    const { root } = mount();
    walk(root, 1);
    expect(text(root, "[data-live-after]")).toContain(
      "1. kitchen sent DISH_READY to waiter: serving → carryingDish",
    );
    expect(root.querySelector("[data-live-dropped]")).toBeNull();
  });

  test("the Step tab says a dropped one was dropped", () => {
    const { root } = mount();
    walk(root, 4);
    expect(text(root, "[data-live-dropped]")).toBe(
      "! 2. kitchen sent DISH_READY to waiter: lost, nobody took it in onBreak",
    );
    expect(root.querySelector("[data-live-dropped]")?.classList.contains("muted")).toBe(false);
  });

  test("a drop with no known sender still reads as lost", () => {
    const { root } = mount(null);
    walk(root, 4);
    expect(text(root, "[data-live-dropped]")).toBe(
      "! 2. DISH_READY to waiter: lost, nobody took it in onBreak",
    );
  });

  test("a stay that took the message reads sent … to … without a move", () => {
    const run = recorded("");
    run[0] = { last: entry({}), after: [{ ...taken, outcome: "stay", to: "waiter.serving" }] };
    const root = document.createElement("div");
    const steps: VizStep[] = [];
    const driver: VizDriver = {
      reset: () => ({ ...base(), steps: [] }),
      step: (step) => ({ ...base(), steps: [...steps, step] }),
    };
    const base = (): VizLiveState => ({
      state: "cooking",
      regions: { waiter: "waiter.serving" },
      children: [],
      steps,
      last: run[0]!.last,
      after: run[0]!.after,
      timers: [],
      context: null,
      payload: null,
      effectMode: "real",
      waiting: [],
    });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [kitchen] }, { driver });
    send(root, "DISH_COOKED");
    expect(text(root, "[data-live-after]")).toBe(
      "1. kitchen sent DISH_READY to waiter: stayed in serving",
    );
  });
});

describe("a drop shows its reason once", () => {
  test("the Step tab says why a message was dropped once", () => {
    const { root } = mount();
    walk(root, 4);
    expect(root.textContent?.match(/nobody took it/g)).toHaveLength(1);
  });
});

describe("the Step tab lists the whole walk", () => {
  test("every step shows oldest first", () => {
    const { root } = mount();
    walk(root, 5);
    const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
    expect(steps.map((each) => each.dataset["step"])).toEqual(["1", "2", "3", "4", "5"]);
    expect(steps[0]?.querySelector("[data-live-outcome]")?.textContent).toMatch(
      /^Step 1 of 5: DISH_COOKED/,
    );
  });

  test("messages are numbered over the whole walk", () => {
    const { root } = mount();
    walk(root, 5);
    const numbers = [...root.querySelectorAll<HTMLElement>("[data-message]")].map((each) => [
      each.dataset["message"],
      each.textContent,
    ]);
    expect(numbers).toEqual([
      ["1", "1. kitchen sent DISH_READY to waiter: serving → carryingDish"],
      ["2", "! 2. kitchen sent DISH_READY to waiter: lost, nobody took it in onBreak"],
    ]);
  });

  test("the step list shows no numbers of its own", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(join(import.meta.dirname, "viewer.css"), "utf8");
    document.head.append(style);
    const { root } = mount();
    document.body.append(root);
    walk(root, 5);
    const list = root.querySelector(".explore-run");
    expect(list && getComputedStyle(list).paddingLeft).toBe("0px");
    root.remove();
    style.remove();
  });

  test("only the newest step carries data-outcome", () => {
    const { root } = mount();
    walk(root, 5);
    const marked = root.querySelectorAll("[data-outcome]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(root.querySelector("[data-step='5']"));
  });

  test("no steps says so", () => {
    const { root } = mount();
    expect(text(root, "[data-live-empty]")).toBe(
      "No steps yet. Click an arrow on the board to send an event.",
    );
    expect(root.querySelector("[data-step]")).toBeNull();
  });
});
