// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizJson,
  VizLiveState,
  VizMachine,
  VizState,
  VizStep,
} from "../schema.ts";
import { mountViewer } from "./embed.ts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

function state(id: string, flags: { initial?: boolean; final?: boolean } = {}): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: flags.initial ?? false,
    final: flags.final ?? false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

const checkout: VizMachine = {
  id: "checkout",
  initial: "idle",
  regions: [],
  maps: [],
  actors: [],
  states: [state("idle", { initial: true }), state("paying"), state("error", { final: true })],
  events: [
    { id: "submit", internal: false, doc: null, payload: null },
    { id: "paymentTimeout", internal: true, doc: null, payload: null },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edge("idle", "submit", "paying"), edge("paying", "paymentTimeout", "error")],
  runs: [],
  fuzz: {
    seed: 1,
    iterations: 1,
    corpus: [
      {
        steps: [
          { kind: "event", event: "submit", payload: { amount: 5 } },
          { kind: "event", event: "submit", payload: { amount: 5 } },
          { kind: "event", event: "submit", payload: { amount: 9 } },
        ],
        discovered: [],
      },
    ],
    errors: [],
    failedExpectations: [],
    expectations: [],
  },
};

/** A pure function of the step log, like the real driver after reset + replay. */
function driver(held: VizJson = null): VizDriver & { log: VizStep[][] } {
  const log: VizStep[][] = [];
  const run = (steps: VizStep[]): VizLiveState => {
    let now = 0;
    let current = "idle";
    let deadline: number | null = null;
    let context: VizLiveState["context"] = null;
    for (const step of steps) {
      if (step.kind === "advance") now += step.ms;
      else if (step.event === "nope") throw new Error("unknown event nope");
      else if (step.event === "submit" && current === "idle") {
        current = "paying";
        deadline = now + 800;
        context = step.payload;
      }
      if (current === "paying" && deadline !== null && now >= deadline) current = "error";
    }
    return {
      state: current,
      steps,
      last: null,
      after: [],
      timers:
        current === "paying" && deadline !== null
          ? [{ id: "t1", ms: 800, deadline, eventName: "paymentTimeout" }]
          : [],
      context,
      payload: held,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    };
  };
  const done: VizStep[] = [];
  return {
    log,
    reset: () => {
      done.length = 0;
      return run([]);
    },
    step: (step) => {
      done.push(step);
      log.push([...done]);
      return run([...done]);
    },
  };
}

function mount(
  options: {
    steps?: string[];
    onNavigate?: (w: { steps: string[] }) => void;
  } = {},
) {
  const root = document.createElement("div");
  const live = driver();
  mountViewer(
    root,
    { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
    {
      driver: live,
      ...options,
    },
  );
  return { root, live };
}

const click = (root: HTMLElement, selector: string) =>
  root.querySelector<HTMLButtonElement>(selector)?.click();

/** A visual viewport that counts the listeners still attached. */
function countingViewport() {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const target = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
    if (listener !== null) listeners.add(listener);
    add(type, listener);
  };
  target.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) => {
    if (listener !== null) listeners.delete(listener);
    remove(type, listener);
  };
  vi.stubGlobal("visualViewport", target);
  vi.stubGlobal("innerHeight", 844);
  return listeners;
}

afterEach(() => vi.unstubAllGlobals());

describe("payload sheet keyboard listeners across a redraw", () => {
  test("no listener outlives a sheet the viewer redraws away", () => {
    const listeners = countingViewport();
    const { root } = mount();
    document.body.append(root);
    click(root, '[data-send="submit"]');
    expect(root.querySelectorAll(".payload-sheet")).toHaveLength(1);
    const open = listeners.size;
    expect(open).toBeGreaterThan(0);
    click(root, '[data-tab="controls"]');
    click(root, "[data-diagram-only]");
    click(root, "[data-show-controls]");
    expect(root.querySelectorAll(".payload-sheet")).toHaveLength(1);
    expect(listeners.size).toBe(open);
    click(root, '[data-payload-cancel="submit"]');
    expect(root.querySelectorAll(".payload-sheet")).toHaveLength(0);
    expect(listeners.size).toBe(0);
    root.remove();
  });
});
