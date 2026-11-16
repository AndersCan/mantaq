// @vitest-environment happy-dom
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type {
  VizDriver,
  VizEdge,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizOutputRoutes,
  VizState,
  VizStep,
} from "../schema.ts";
import { decodeLiveSteps, encodeLiveStep, payloadSamples } from "../moves.ts";
import { mountViewer } from "./embed.ts";
import { describe, expect, test, vi } from "vite-plus/test";
import { sendVia } from "./send-via.ts";

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
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      const from = current;
      if (step.kind === "advance") now += step.ms;
      else if (step.event === "nope") throw new Error("unknown event nope");
      else if (step.event === "submit" && current === "idle") {
        current = "paying";
        deadline = now + 800;
        context = step.payload;
      }
      if (current === "paying" && deadline !== null && now >= deadline) current = "error";
      if (step.kind === "event" && step.event === "submit" && from === "idle") {
        last = {
          from,
          event: step.event,
          to: current,
          outcome: "transition",
          effects: [],
          sent: [],
          context,
          error: null,
        };
      }
    }
    return {
      state: current,
      steps,
      last,
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
/** Sends `submit` from the Step tab. */
function sendSubmit(root: HTMLElement) {
  sendVia(root, "submit");
}
const current = (root: HTMLElement) => root.querySelector(".explore")?.getAttribute("data-current");

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("live controls", () => {
  test("a timer button advances the clock to its deadline", () => {
    const { root } = mount();
    expect(root.querySelector("[data-advance-timer]")).toBeNull();
    sendSubmit(root);
    const timer = root.querySelector("[data-advance-timer]");
    expect(timer?.textContent).toBe("advance 800 ms → paymentTimeout");
    click(root, "[data-advance-timer]");
    expect(current(root)).toBe("error");
  });

  test("the timer label counts down the time already advanced", () => {
    const { root } = mount();
    sendSubmit(root);
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

  test("an edge click on an event with no payload still sends at once", () => {
    const toggle: VizMachine = {
      ...checkout,
      states: [state("off", { initial: true }), state("on")],
      initial: "off",
      events: [{ id: "flip", internal: false, doc: null, payload: null }],
      edges: [edge("off", "flip", "on")],
      fuzz: null,
    };
    const log: VizStep[] = [];
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [toggle] },
      {
        driver: {
          reset: () => flipLive([]),
          step: (step) => {
            log.push(step);
            return flipLive([...log]);
          },
        },
      },
    );
    function flipLive(steps: VizStep[]): VizLiveState {
      return {
        state: steps.length === 0 ? "off" : "on",
        steps,
        last: null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      };
    }
    sendVia(root, "flip");
    expect(log).toEqual([{ kind: "event", event: "flip", payload: null }]);
  });

  test("an edge click on an event with no data sends at once when fuzzing only sent it {}", () => {
    const toggle: VizMachine = {
      ...checkout,
      states: [state("off", { initial: true }), state("on")],
      initial: "off",
      events: [{ id: "flip", internal: false, doc: null, payload: null }],
      edges: [edge("off", "flip", "on")],
      fuzz: {
        ...checkout.fuzz!,
        corpus: [{ steps: [{ kind: "event", event: "flip", payload: {} }], discovered: [] }],
      },
    };
    const log: VizStep[] = [];
    const root = document.createElement("div");
    const flipLive = (steps: VizStep[]): VizLiveState => ({
      state: steps.length === 0 ? "off" : "on",
      steps,
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
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [toggle] },
      {
        driver: {
          reset: () => flipLive([]),
          step: (step) => {
            log.push(step);
            return flipLive([...log]);
          },
        },
      },
    );
    sendVia(root, "flip");
    expect(log).toHaveLength(1);
    expect(log[0]?.kind === "event" && log[0].event).toBe("flip");
  });

  test("no diagram click sends", () => {
    const { root, live } = mount();
    const targets = [...root.querySelectorAll(".graph [data-edge-id], .graph [data-node-id]")];
    expect(targets.length).toBeGreaterThan(0);
    const before = current(root);
    for (const target of targets) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(current(root)).toBe(before);
      expect(live.log).toHaveLength(0);
      expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    }
  });

  test("the selected arrow's Details has a Send button that sends and keeps the tab", () => {
    const { root, live } = mount();
    clickEdge(root, "idle-submit-paying");
    const button = root.querySelector<HTMLButtonElement>("[data-send-edge]");
    expect(button?.textContent).toBe("Send submit");
    expect(current(root)).toBe("idle");
    button?.click();
    expect(live.log).toHaveLength(1);
    expect(current(root)).toBe("paying");
    expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("after a Details send, the Details say what was sent, with its values", () => {
    const { root } = mount();
    const detailsSent = () => root.querySelector("[data-details-sent]")?.textContent;
    clickEdge(root, "idle-submit-paying");
    expect(detailsSent()).toBeUndefined();
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(detailsSent()).toBe(`Sent submit with {"amount":5}: idle → paying`);
    expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    clickEdge(root, "paying-paymentTimeout-error");
    expect(detailsSent()).toBeUndefined();
  });

  test("after a Details send, focus is on the selected arrow", () => {
    const { root } = mount();
    document.body.append(root);
    clickEdge(root, "idle-submit-paying");
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(document.activeElement?.getAttribute("data-edge-id")).toBe("idle-submit-paying");
    root.remove();
  });

  test("the Step tab has no Send buttons; the selected arrow's Details has one", () => {
    const { root } = mount();
    expect(current(root)).toBe("idle");
    expect(root.querySelectorAll(".explore [data-send]")).toHaveLength(0);
    expect(root.querySelector(".explore [data-doc]")).toBeNull();
    clickEdge(root, "idle-submit-paying");
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(current(root)).toBe("paying");
  });

  test("an arrow whose source is not current has no Send button", () => {
    const { root } = mount();
    clickEdge(root, "paying-paymentTimeout-error");
    expect(root.querySelector("[data-selected-edge]")).not.toBeNull();
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("the initial arrow has no Send button", () => {
    const { root } = mount();
    clickEdge(root, "__initial__--idle");
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("no arrow link in a state's Details sends", () => {
    const { root, live } = mount();
    const before = current(root);
    root
      .querySelector(`.graph [data-node-id="${before}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const links = [...root.querySelectorAll<HTMLElement>("[data-edge-link]")].map((link) =>
      link.getAttribute("data-edge-link"),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const id of links) {
      root
        .querySelector(`.graph [data-node-id="${before}"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      root.querySelector<HTMLElement>(`[data-edge-link="${id}"]`)?.click();
      expect(current(root)).toBe(before);
      expect(live.log).toHaveLength(0);
      expect(root.querySelector(`[data-selected-edge="${id}"]`)).not.toBeNull();
    }
  });

  test("clicks never scroll or rebuild the canvas", () => {
    const { root } = mount();
    const canvas = root.querySelector(".canvas");
    const scroll = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);
    clickEdge(root, "idle-submit-paying");
    clickEdge(root, "paying-paymentTimeout-error");
    root.querySelector("[data-node-id]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click(root, "[data-send-edge]");
    expect(canvas).not.toBeNull();
    expect(root.querySelector(".canvas")).toBe(canvas);
    expect(scroll).not.toHaveBeenCalled();
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
    vi.restoreAllMocks();
  });

  test("back replays the log without the last step", () => {
    const { root } = mount();
    sendSubmit(root);
    click(root, "[data-advance-timer]");
    click(root, '[data-explore-action="back"]');
    expect(current(root)).toBe("paying");
  });

  test("the URL steps round-trip to the same state", () => {
    const seen: string[][] = [];
    const first = mount({ onNavigate: (where) => seen.push(where.steps) });
    sendSubmit(first.root);
    click(first.root, "[data-advance-timer]");
    const steps = seen.at(-1) ?? [];
    expect(steps).toEqual(['submit={"amount":5}', "@800"]);
    const second = mount({ steps });
    expect(current(second.root)).toBe(current(first.root));
  });
});

describe("runs", () => {
  const submit: VizStep = {
    kind: "event",
    event: "submit",
    payload: { amount: 5 },
  };
  const withRuns: VizMachine = {
    ...checkout,
    runs: [
      {
        name: "pays and times out",
        steps: [submit, { kind: "advance", ms: 800 }],
      },
      { name: "submits", steps: [submit] },
      { name: "empty", steps: [] },
      {
        name: "breaks",
        steps: [{ kind: "event", event: "nope", payload: null }, submit],
      },
    ],
  };

  function mountRun(options: { run: string; steps?: string[]; driven?: boolean }) {
    const root = document.createElement("div");
    const seen: unknown[] = [];
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns] },
      {
        ...(options.driven === false ? {} : { driver: driver() }),
        run: options.run,
        ...(options.steps === undefined ? {} : { steps: options.steps }),
        onNavigate: (where) => seen.push(where),
      },
    );
    return { root, seen };
  }

  test("run= opens on a run's end state without navigating on mount", () => {
    const { root, seen } = mountRun({ run: "pays and times out" });
    expect(current(root)).toBe("error");
    expect(seen).toEqual([]);
  });

  test("run= wins over steps", () => {
    const { root } = mountRun({ run: "submits", steps: ["@800"] });
    expect(current(root)).toBe("paying");
  });

  test("an unknown run opens the start with a notice that the next step clears", () => {
    const { root } = mountRun({ run: "nope" });
    expect(current(root)).toBe("idle");
    const notice = root.querySelector("[data-run-missing]")?.textContent ?? "";
    expect(notice).toContain('No run named "nope"');
    expect(notice).toContain("submits");
    sendSubmit(root);
    expect(root.querySelector("[data-run-missing]")).toBeNull();
  });

  test("an unknown run in a machine without runs says so", () => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      { driver: driver(), run: "x" },
    );
    expect(root.querySelector("[data-run-missing]")?.textContent).toBe(
      'No run named "x" in checkout; it has no recorded runs.',
    );
  });

  test("a run without a driver says it replays only live", () => {
    const { root } = mountRun({ run: "submits", driven: false });
    expect(root.querySelector("[data-run-missing]")?.textContent).toContain(
      "replays only when checkout runs live",
    );
  });

  test("a run name from the URL is shown as text, not markup", () => {
    const { root } = mountRun({ run: "<b>x</b>" });
    expect(root.querySelector("[data-run-missing] b")).toBeNull();
    expect(root.querySelector("[data-run-missing]")?.textContent).toContain("<b>x</b>");
  });

  test("switching machine clears the run notice", () => {
    const other: VizMachine = { ...checkout, id: "other" };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withRuns, other] },
      { run: "nope", machine: withRuns.id },
    );
    expect(root.querySelector("[data-run-missing]")).not.toBeNull();
    const picker = root.querySelector("select");
    if (picker === null) throw new Error("no machine picker");
    picker.value = "other";
    picker.dispatchEvent(new Event("change"));
    expect(root.querySelector("[data-run-missing]")).toBeNull();
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

describe("field forms and the context table", () => {
  const fieldsMachine: VizMachine = {
    ...checkout,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          {
            name: "validFor",
            type: '"10m" | "1h"',
            optional: false,
            doc: "How long it works.",
            input: "choice",
            choices: ["10m", "1h"],
            sample: "10m",
          },
          {
            name: "note",
            type: "string",
            optional: true,
            doc: null,
            input: "text",
            choices: [],
            sample: "sample",
          },
          {
            name: "flags",
            type: "{ a: boolean }",
            optional: true,
            doc: null,
            input: "json",
            choices: [],
            sample: { a: true },
          },
        ],
      },
      { id: "ping", internal: false, doc: null, payload: null },
    ],
    edges: [...checkout.edges, { ...edge("idle", "ping", "idle"), kind: "stay" }],
    context: [
      {
        name: "amount",
        type: "number",
        optional: false,
        doc: "What is owed.",
        input: "number",
        choices: [],
        sample: 1,
      },
    ],
    fuzz: null,
  };

  function mountFields(
    machine: VizMachine = fieldsMachine,
    extra: Partial<Parameters<typeof mountViewer>[2]> = {},
  ) {
    const root = document.createElement("div");
    const live = driver();
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { driver: live, ...extra },
    );
    return { root, live };
  }
  const valueBox = (root: HTMLElement, name: string) =>
    root.querySelector<HTMLInputElement>(`[data-value="${name}"]`);
  const setBox = (root: HTMLElement, name: string, text: string) => {
    const box = valueBox(root, name);
    if (box) box.value = text;
    box?.dispatchEvent(new Event("change", { bubbles: true }));
  };

  test("the note is present when live and absent without a driver", () => {
    expect(mountFields().root.querySelector("[data-live-note]")).not.toBeNull();
    const root = document.createElement("div");
    mountViewer(root, {
      schemaVersion: VIZ_SCHEMA_VERSION,
      machines: [fieldsMachine],
    });
    expect(root.querySelector("[data-live-note]")).toBeNull();
  });

  test("an event with no payload fields and no samples sends at once", () => {
    const { root, live } = mountFields();
    sendVia(root, "ping");
    expect(live.log[0]).toEqual([{ kind: "event", event: "ping", payload: null }]);
  });

  const requiredMachine: VizMachine = {
    ...fieldsMachine,
    events: [
      {
        id: "submit",
        internal: false,
        doc: null,
        payload: [
          {
            name: "amount",
            type: "number",
            optional: false,
            doc: null,
            input: "number",
            choices: [],
            sample: 1,
          },
          {
            name: "label",
            type: "string",
            optional: false,
            doc: null,
            input: "text",
            choices: [],
            sample: "hi",
          },
        ],
      },
    ],
  };

  test("an arrow click sends at once with the examples and opens no form", () => {
    const { root, live } = mountFields(requiredMachine);
    sendSubmit(root);
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 1, label: "hi" } },
    ]);
  });

  test("a value set in the Context tab is sent by every later click, kept for onNavigate and across Back", () => {
    const seen: string[][] = [];
    const { root, live } = mountFields(requiredMachine, {
      onNavigate: (where) => seen.push(where.values),
    });
    expect(valueBox(root, "amount")?.placeholder).toBe("1");
    setBox(root, "amount", "7.5");
    expect(seen.at(-1)).toEqual(["amount=7.5"]);
    sendSubmit(root);
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 7.5, label: "hi" } },
    ]);
    expect(seen.at(-1)).toEqual(["amount=7.5"]);
    click(root, '[data-explore-action="back"]');
    expect(valueBox(root, "amount")?.value).toBe("7.5");
    sendSubmit(root);
    expect(live.log.at(-1)).toEqual([
      { kind: "event", event: "submit", payload: { amount: 7.5, label: "hi" } },
    ]);
  });

  test("values from the address are sent, and clearing the box sends the example again", () => {
    const { root, live } = mountFields(requiredMachine, { values: ['label="from url"', "bad"] });
    expect(valueBox(root, "label")?.value).toBe("from url");
    setBox(root, "amount", "2");
    setBox(root, "amount", "");
    sendSubmit(root);
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 1, label: "from url" } },
    ]);
  });

  test("text that is not a value empties the box, so the grey default is what is sent", () => {
    const { root, live } = mountFields(requiredMachine);
    setBox(root, "amount", "7");
    setBox(root, "amount", "seven");
    expect(valueBox(root, "amount")?.value).toBe("");
    sendSubmit(root);
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 1, label: "hi" } },
    ]);
  });

  test("a name optional on one event and required on another shows the default the click sends", () => {
    const label = requiredMachine.events[0]?.payload?.[1];
    if (label === undefined) throw new Error("fixture");
    const shared: VizMachine = {
      ...requiredMachine,
      events: [
        { id: "draft", internal: false, doc: null, payload: [{ ...label, optional: true }] },
        ...requiredMachine.events,
      ],
    };
    const { root, live } = mountFields(shared);
    expect(valueBox(root, "label")?.placeholder).toBe("hi");
    sendSubmit(root);
    expect(live.log[0]).toEqual([
      { kind: "event", event: "submit", payload: { amount: 1, label: "hi" } },
    ]);
  });
});

describe("what ran", () => {
  const branching: VizMachine = {
    ...checkout,
    edges: [
      {
        ...edge("idle", "submit", "paying"),
        explanation: {
          status: "analyzed",
          location: { file: "m.ts", line: 1, column: 1 },
          registration: "on",
          branches: [
            {
              conditions: ["payload.amount > 5"],
              target: { kind: "state", state: "paying" },
            },
            { conditions: ["!(payload.amount > 5)"], target: { kind: "stay" } },
          ],
          payloadReads: [],
          contextReads: [],
          contextWrites: [],
          readsActorState: false,
          comparisons: [],
          literals: [],
        },
      },
    ],
  };
  const mountWith = (machine: VizMachine, live: VizDriver, routes?: VizOutputRoutes) => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
      { driver: live, ...(routes === undefined ? {} : { routes }) },
    );
    return root;
  };
  const text = (root: HTMLElement, hook: string) =>
    root.querySelector(`[data-live-${hook}]`)?.textContent;
  const submit = {
    kind: "event",
    event: "submit",
    payload: { amount: 9 },
  } as const;

  function stepped(
    entry: Partial<VizLiveState["last"] & object>,
    after: VizLiveState["after"] = [],
  ) {
    const base: VizLiveStep = {
      from: "idle",
      event: "submit",
      to: "paying",
      outcome: "transition",
      effects: [],
      sent: [],
      context: { amount: 9 },
      error: null,
    };
    const last: VizLiveStep = { ...base, ...entry };
    let onChange: (state: VizLiveState) => void = () => undefined;
    const live: VizDriver = {
      reset: () => ({
        state: "idle",
        steps: [],
        last: null,
        after: [],
        timers: [],
        context: {},
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      }),
      step: (step) => ({
        state: last.to,
        steps: [step],
        last,
        after,
        timers: [],
        context: last.context,
        payload: null,
        regions: {},
        children: [],
        effectMode: "real",
        waiting: [],
      }),
      listen: (callback) => {
        onChange = callback;
      },
    };
    return { live, push: (state: VizLiveState) => onChange(state) };
  }

  test("Because shows the condition for a transition and a stay", () => {
    const move = mountWith(branching, stepped({}).live);
    sendVia(move, "submit");
    expect(text(move, "outcome")).toBe("submit: idle → paying");
    expect(text(move, "because")).toBe("Because: payload.amount > 5");

    const stay = mountWith(branching, stepped({ to: "idle", outcome: "stay", context: {} }).live);
    sendVia(stay, "submit");
    expect(text(stay, "outcome")).toBe("submit: handled in idle, stays");
    expect(text(stay, "because")).toBe("Because: !(payload.amount > 5)");
  });

  test("Sent out names each output, with where the app takes it when the page knows", () => {
    const routes: VizOutputRoutes = {
      [branching.id]: { openAlbum: [{ to: "router", event: "NAVIGATED", at: "a.ts:72" }] },
    };
    const send = (root: HTMLElement) => {
      sendVia(root, "submit");
    };
    const routed = mountWith(branching, stepped({ sent: ["openAlbum"] }).live, routes);
    send(routed);
    expect(text(routed, "sent")).toBe("Sent out: openAlbum → router takes NAVIGATED (a.ts:72)");

    const bare = mountWith(branching, stepped({ sent: ["openAlbum"] }).live);
    send(bare);
    expect(text(bare, "sent")).toBe("Sent out: openAlbum");

    const several = mountWith(
      branching,
      stepped({ sent: ["openAlbum", "ANSWER_SENT"] }).live,
      routes,
    );
    send(several);
    expect(text(several, "sent")).toBe(
      "Sent out: openAlbum → router takes NAVIGATED (a.ts:72); ANSWER_SENT",
    );

    const quiet = mountWith(branching, stepped({}).live, routes);
    send(quiet);
    expect(quiet.querySelector("[data-live-sent]")).toBeNull();
  });

  test("Because is absent when every branch shares a target", () => {
    const plain: VizMachine = {
      ...branching,
      edges: branching.edges.map((candidate) =>
        candidate.explanation?.status === "analyzed"
          ? {
              ...candidate,
              explanation: {
                ...candidate.explanation,
                branches: [
                  {
                    conditions: ["a"],
                    target: { kind: "state", state: "paying" },
                  },
                  {
                    conditions: ["!a"],
                    target: { kind: "state", state: "paying" },
                  },
                ],
              },
            }
          : candidate,
      ),
    };
    const root = mountWith(plain, stepped({}).live);
    sendVia(root, "submit");
    expect(root.querySelector("[data-live-because]")).toBeNull();
  });

  test("Changed names the keys and Effects started names the effects", () => {
    const root = mountWith(
      branching,
      stepped({ effects: ["charge"], context: { amount: 9, tag: "x" } }).live,
    );
    sendVia(root, "submit");
    expect(text(root, "changed")).toBe("Changed: amount, tag");
    expect(text(root, "effects")).toBe("Effects started: charge");
  });

  test("an async result renders without another click", () => {
    const { live, push } = stepped({});
    const root = mountWith(branching, live);
    sendVia(root, "submit");
    expect(root.querySelector("[data-live-after]")).toBeNull();
    push({
      state: "error",
      steps: [submit],
      last: {
        from: "idle",
        event: "submit",
        to: "paying",
        outcome: "transition",
        effects: [],
        sent: [],
        context: { amount: 9 },
        error: null,
      },
      after: [
        {
          from: "paying",
          event: "paymentTimeout",
          to: "error",
          outcome: "transition",
          effects: [],
          sent: [],
          context: { amount: 9, failed: true },
          error: null,
        },
      ],
      timers: [],
      context: { amount: 9, failed: true },
      payload: null,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    });
    const after = root.querySelector("[data-live-after]");
    expect(after?.textContent).toContain("Then paymentTimeout came back");
    expect(after?.textContent).toContain("paymentTimeout: paying → error");
    expect(after?.textContent).toContain("Changed: failed");
  });

  test("an ignored event says nothing ran", () => {
    const root = mountWith(branching, stepped({ to: "idle", outcome: "ignored" }).live);
    sendVia(root, "submit");
    expect(text(root, "outcome")).toBe("No handler for submit in idle. Nothing ran.");
  });
});

describe("live effect reports", () => {
  const withDoc = (from: string, event: string, to: string, doc: string | null): VizEdge => ({
    ...edge(from, event, to),
    doc,
  });
  const fetcher: VizMachine = {
    ...checkout,
    id: "fetcher",
    initial: "waiting",
    states: [
      state("waiting", { initial: true }),
      {
        ...state("fetching"),
        effects: [
          {
            name: "fetchList",
            sends: ["listFetched", "fetchFailed", "fetchGone"],
          },
        ],
      },
      state("couldNotFetch"),
    ],
    events: [
      { id: "start", internal: false, doc: null, payload: null },
      { id: "listFetched", internal: true, doc: null, payload: null },
      { id: "fetchFailed", internal: true, doc: null, payload: null },
      { id: "fetchGone", internal: true, doc: null, payload: null },
    ],
    edges: [
      edge("waiting", "start", "fetching"),
      withDoc("fetching", "listFetched", "waiting", "The list is shown."),
      withDoc(
        "fetching",
        "fetchFailed",
        "couldNotFetch",
        "Fetching failed: the person can try again.",
      ),
    ],
    fuzz: {
      ...checkout.fuzz,
      seed: 1,
      iterations: 1,
      errors: [],
      failedExpectations: [],
      expectations: [],
      corpus: [],
    },
  };
  const next: Record<string, Record<string, string>> = {
    waiting: { start: "fetching" },
    fetching: { listFetched: "waiting", fetchFailed: "couldNotFetch" },
  };
  function fetchDriver(mode: "held" | "real" = "real", held = ["fetchList"]): VizDriver {
    const run = (steps: VizStep[]): VizLiveState => {
      let current = "waiting";
      for (const step of steps) {
        if (step.kind === "event") current = next[current]?.[step.event] ?? current;
      }
      return {
        state: current,
        steps,
        last:
          current === "fetching"
            ? {
                from: "waiting",
                event: "start",
                to: "fetching",
                outcome: "transition",
                effects: ["fetchList"],
                sent: [],
                context: null,
                error: null,
              }
            : null,
        after: [],
        timers: [],
        context: null,
        payload: null,
        regions: {},
        effectMode: mode,
        waiting: mode === "held" && current === "fetching" ? held : [],
        children: [],
      };
    };
    const done: VizStep[] = [];
    return {
      reset: () => {
        done.length = 0;
        return run([]);
      },
      step: (step) => {
        done.push(step);
        return run([...done]);
      },
    };
  }
  function mountFetcher(
    options: {
      mode?: "held" | "real";
      machine?: VizMachine;
      held?: string[];
    } = {},
  ) {
    const root = document.createElement("div");
    mountViewer(
      root,
      {
        schemaVersion: VIZ_SCHEMA_VERSION,
        machines: [options.machine ?? fetcher],
      },
      { driver: fetchDriver(options.mode, options.held) },
    );
    sendVia(root, "start");
    return root;
  }
  test("picking the failure moves down the error path and Back undoes it", () => {
    const root = mountFetcher();
    sendVia(root, "fetchFailed");
    expect(current(root)).toBe("couldNotFetch");
    click(root, '[data-explore-action="back"]');
    expect(current(root)).toBe("fetching");
  });

  describe("held", () => {
    const line = (root: HTMLElement, hook: string) =>
      root.querySelector(`[data-live-${hook}]`)?.textContent;
    test("the live section carries the effect mode and no explaining paragraph", () => {
      const root = mountFetcher({ mode: "held" });
      const section = root.querySelector("section.explore");
      expect(section?.hasAttribute("data-live-note")).toBe(true);
      expect(section?.getAttribute("data-effect-mode")).toBe("held");
      expect(root.querySelector(".explore-note")).toBeNull();
      expect(root.querySelector(".explore-waiting")).toBeNull();
    });

    test("a step into fetching names the effect it did not run and what it would send", () => {
      const root = mountFetcher({ mode: "held" });
      expect(line(root, "not-run")).toBe(
        "Not run here: fetchList (it would send listFetched or fetchFailed or fetchGone)",
      );
    });

    test("an effect that declares no sends is named alone", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "fetching"
            ? { ...each, effects: [{ name: "fetchList", sends: null }] }
            : each,
        ),
      };
      const root = mountFetcher({ mode: "held", machine });
      expect(line(root, "not-run")).toBe("Not run here: fetchList");
    });

    const withEffects = (effects: string[]): VizDriver => {
      const held = fetchDriver("held");
      return {
        ...held,
        step: (step) => {
          const live = held.step(step);
          return live.last === null ? live : { ...live, last: { ...live.last, effects } };
        },
      };
    };
    const mountHeld = (machine: VizMachine, live: VizDriver) => {
      const root = document.createElement("div");
      mountViewer(
        root,
        { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] },
        { driver: live },
      );
      sendVia(root, "start");
      return root;
    };

    test("a held step that started no effect has no Not run here line", () => {
      const root = mountHeld(fetcher, withEffects([]));
      expect(line(root, "outcome")).toBe("start: waiting → fetching");
      expect(root.querySelector("[data-live-not-run]")).toBeNull();
    });

    test("several effects not run are joined in order", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "fetching"
            ? {
                ...each,
                effects: [
                  { name: "fetchList", sends: ["listFetched"] },
                  { name: "logVisit", sends: [] },
                ],
              }
            : each,
        ),
      };
      const root = mountHeld(machine, withEffects(["fetchList", "logVisit"]));
      expect(line(root, "not-run")).toBe(
        "Not run here: fetchList (it would send listFetched); logVisit",
      );
      expect(
        [...root.querySelectorAll("[data-live-not-run] code")].map((each) => each.textContent),
      ).toEqual(["fetchList", "listFetched", "logVisit"]);
    });

    test("real mode has no Not run here line", () => {
      const root = mountFetcher({ mode: "real" });
      expect(root.querySelector("[data-live-not-run]")).toBeNull();
      expect(line(root, "effects")).toBe("Effects started: fetchList");
    });

    test("the outcome does not repeat the effects line", () => {
      const root = mountFetcher({ mode: "held" });
      expect(root.querySelector("[data-live-effects]")).toBeNull();
      expect(root.querySelector(".explore-effects")).toBeNull();
    });

    test("a final root with a held effect shows no clock", () => {
      const machine: VizMachine = {
        ...fetcher,
        states: fetcher.states.map((each) =>
          each.id === "fetching" ? { ...each, final: true } : each,
        ),
      };
      const root = mountFetcher({ mode: "held", machine });
      expect(root.querySelector(".explore-now")?.textContent).toBe("In fetching (final)");
      expect(root.querySelector("[data-advance]")).toBeNull();
    });

    test("picking a report moves on and Back returns to the state", () => {
      const root = mountFetcher({ mode: "held" });
      sendVia(root, "fetchFailed");
      expect(current(root)).toBe("couldNotFetch");
      click(root, '[data-explore-action="back"]');
      expect(current(root)).toBe("fetching");
    });
  });

  test("at rest the Step tab shows the clock and no Send buttons, in no fold", () => {
    const root = mountFetcher();
    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector(".explore [data-send]")).toBeNull();
    expect(root.querySelector(".explore [data-advance]")).not.toBeNull();
  });
});

describe("Show controls, live", () => {
  test("opens the Step tab", () => {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      { driver: driver(), diagramOnly: true },
    );
    expect(root.querySelector(".panel")).toBeNull();
    click(root, "[data-show-controls]");
    const ids = [...root.querySelectorAll("[data-tab]")].map((tab) => tab.getAttribute("data-tab"));
    expect(ids).toEqual(["step", "details"]);
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Step");
  });
});

describe("Details and Step tab with docs", () => {
  test("the Step tab shows no state doc; a sendable arrow's Details are title, Send, doc", () => {
    const root = document.createElement("div");
    const documented: VizMachine = {
      ...checkout,
      states: checkout.states.map((candidate) =>
        candidate.id === "idle" ? { ...candidate, doc: "Waiting for an order." } : candidate,
      ),
      edges: checkout.edges.map((candidate) =>
        candidate.id === "idle-submit-paying" ? { ...candidate, doc: "Pay for it." } : candidate,
      ),
    };
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [documented] },
      { driver: driver() },
    );
    expect(current(root)).toBe("idle");
    expect(root.querySelector(".explore [data-doc]")).toBeNull();
    clickEdge(root, "idle-submit-paying");
    const children = [...(root.querySelector(".details")?.children ?? [])].map(
      (child) =>
        child.getAttribute("data-send-edge") ??
        child.getAttribute("data-doc") ??
        child.tagName.toLowerCase(),
    );
    expect(children).toEqual(["h2", "idle-submit-paying", "edge"]);
  });
});
