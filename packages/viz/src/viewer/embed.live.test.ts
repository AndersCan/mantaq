// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDriver, VizEdge, VizLiveState, VizMachine, VizState, VizStep } from "../schema.ts";
import { decodeLiveSteps, encodeLiveStep, payloadSamples } from "../moves.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

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
  states: [state("idle", { initial: true }), state("paying"), state("error", { final: true })],
  events: [
    { id: "submit", internal: false, doc: null, payloadType: null },
    { id: "paymentTimeout", internal: true, doc: null, payloadType: null },
  ],
  edges: [edge("idle", "submit", "paying"), edge("paying", "paymentTimeout", "error")],
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
  },
};

/** A pure function of the step log, like the real driver after reset + replay. */
function driver(): VizDriver & { log: VizStep[][] } {
  const log: VizStep[][] = [];
  const run = (steps: VizStep[]): VizLiveState => {
    let now = 0;
    let current = "idle";
    let deadline: number | null = null;
    let context: VizLiveState["context"] = null;
    for (const step of steps) {
      if (step.kind === "advance") now += step.ms;
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
      timers:
        current === "paying" && deadline !== null
          ? [{ id: "t1", ms: 800, deadline, eventName: "paymentTimeout" }]
          : [],
      context,
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

function mount(options: { steps?: string[]; onNavigate?: (w: { steps: string[] }) => void } = {}) {
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
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

describe("live controls", () => {
  test("a timer button advances the clock to its deadline", () => {
    const { root } = mount();
    expect(root.querySelector("[data-advance-timer]")).toBeNull();
    click(root, '[data-send="submit"]');
    const timer = root.querySelector("[data-advance-timer]");
    expect(timer?.textContent).toBe("advance 800 ms → paymentTimeout");
    click(root, "[data-advance-timer]");
    expect(current(root)).toBe("error");
    expect(root.querySelector('[data-rewind="2"]')?.textContent).toBe("advance 800 ms");
  });

  test("the timer label counts down the time already advanced", () => {
    const { root } = mount();
    click(root, '[data-send="submit"]');
    const input = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (input) input.value = "300";
    click(root, "[data-advance]");
    expect(current(root)).toBe("paying");
    expect(root.querySelector("[data-advance-timer]")?.textContent).toBe(
      "advance 500 ms → paymentTimeout",
    );
  });

  test("free advance sends the typed milliseconds and rejects bad input", () => {
    const { root, live } = mount();
    const input = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (input) input.value = "-5";
    click(root, "[data-advance]");
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-time [role=alert]")?.hasAttribute("hidden")).toBe(false);
    const again = root.querySelector<HTMLInputElement>("[data-advance-ms]");
    if (again) again.value = "250";
    click(root, "[data-advance]");
    expect(live.log).toEqual([[{ kind: "advance", ms: 250 }]]);
  });

  test("JSON payload is sent with the event", () => {
    const { root, live } = mount();
    const box = root.querySelector<HTMLTextAreaElement>("[data-payload-json]");
    if (box) box.value = '{"amount":42}';
    click(root, '[data-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { amount: 42 } }]);
    expect(root.querySelector("[data-live-context]")?.textContent).toBe(
      'Context{\n  "amount": 42\n}',
    );
  });

  test("invalid JSON sends nothing", () => {
    const { root, live } = mount();
    const box = root.querySelector<HTMLTextAreaElement>("[data-payload-json]");
    if (box) box.value = "{nope";
    click(root, '[data-send="submit"]');
    expect(live.log).toEqual([]);
    expect(root.querySelector(".explore-moves [role=alert]")?.hasAttribute("hidden")).toBe(false);
  });

  test("a fuzz sample is offered once and sent", () => {
    const { root, live } = mount();
    const options = [...root.querySelectorAll('[data-sample="submit"] option')];
    expect(options.map((each) => each.textContent)).toEqual([
      "no payload",
      '{"amount":5}',
      '{"amount":9}',
    ]);
    const select = root.querySelector<HTMLSelectElement>('[data-sample="submit"]');
    if (select) select.value = '{"amount":9}';
    click(root, '[data-send="submit"]');
    expect(live.log[0]).toEqual([{ kind: "event", event: "submit", payload: { amount: 9 } }]);
  });

  test("back replays the log without the last step", () => {
    const { root } = mount();
    click(root, '[data-send="submit"]');
    click(root, "[data-advance-timer]");
    click(root, '[data-explore-action="back"]');
    expect(current(root)).toBe("paying");
    expect(root.querySelectorAll("[data-rewind]")).toHaveLength(2);
  });

  test("the URL steps round-trip to the same state", () => {
    const seen: string[][] = [];
    const first = mount({ onNavigate: (where) => seen.push(where.steps) });
    const box = first.root.querySelector<HTMLTextAreaElement>("[data-payload-json]");
    if (box) box.value = '{"amount":42}';
    click(first.root, '[data-send="submit"]');
    click(first.root, "[data-advance-timer]");
    const steps = seen.at(-1) ?? [];
    expect(steps).toEqual(['submit={"amount":42}', "@800"]);
    const second = mount({ steps });
    expect(current(second.root)).toBe(current(first.root));
    expect(second.root.querySelector("[data-live-context]")?.textContent).toBe(
      first.root.querySelector("[data-live-context]")?.textContent,
    );
  });
});

describe("live step encoding", () => {
  test("round-trips events, payloads and advances", () => {
    const steps: VizStep[] = [
      { kind: "event", event: "go", payload: null },
      { kind: "event", event: "pay", payload: { a: [1, "x=y"], b: null } },
      { kind: "advance", ms: 0 },
      { kind: "advance", ms: 12.5 },
    ];
    expect(decodeLiveSteps(steps.map(encodeLiveStep))).toEqual(steps);
  });

  test("decoding stops at the first bad step", () => {
    expect(decodeLiveSteps(["go", "@-1", "stop"])).toEqual([
      { kind: "event", event: "go", payload: null },
    ]);
    expect(decodeLiveSteps(["a={bad", "go"])).toEqual([]);
    expect(decodeLiveSteps(["@", "=1"])).toEqual([]);
  });

  test("samples skip null payloads and other events", () => {
    expect(payloadSamples(checkout, "paymentTimeout")).toEqual([]);
    expect(payloadSamples(checkout, "submit")).toEqual([{ amount: 5 }, { amount: 9 }]);
  });
});
