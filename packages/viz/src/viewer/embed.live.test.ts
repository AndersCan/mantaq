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
    messages: [],
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
      if (step.kind === "event" && step.event === "paymentTimeout" && current === "paying")
        current = "error";
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
    diagramOnly?: boolean;
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

/** A click on the arrow itself: sends when Details would offer Send. */
const clickArrow = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/** The `?` beside an arrow: opens its Details without sending. */
const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-details-edge="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("live controls", () => {
  test("a live mount has no title, no reachable box and no chip tint", () => {
    const { root } = mount();
    sendSubmit(root);
    expect(root.querySelector("header")).toBeNull();
    const titles = [...root.querySelectorAll("h1, h2, h3")];
    expect(titles.filter((title) => title.closest(".panel") === null)).toEqual([]);
    expect(root.querySelector(".reachable")).toBeNull();
    expect(root.querySelector(".chip.running")).toBeNull();
  });

  test("the current state's effect chip has no tint and is no focus stop", () => {
    const withEffect: VizMachine = {
      ...checkout,
      states: checkout.states.map((each) =>
        each.id === "paying" ? { ...each, effects: [{ name: "charge", sends: null }] } : each,
      ),
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [withEffect] },
      { driver: driver() },
    );
    sendSubmit(root);
    expect(current(root)).toBe("paying");
    const chip = root.querySelector('.chip[data-state="paying"]');
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("running")).toBe(false);
    expect(chip?.hasAttribute("tabindex")).toBe(false);
  });

  test("a timer button advances the clock to its deadline", () => {
    const { root } = mount();
    expect(root.querySelector("[data-advance-timer]")).toBeNull();
    sendSubmit(root);
    const timer = root.querySelector("[data-advance-timer]");
    expect(timer?.textContent).toBe("advance 800 ms → paymentTimeout");
    click(root, "[data-advance-timer]");
    expect(current(root)).toBe("error");
    expect(root.querySelector("[data-step='2'] [data-live-outcome]")?.textContent).toBe(
      "Step 2 of 2: time passed 800 ms",
    );
  });

  test("an advance that fires nothing keeps its own row and later steps keep theirs", () => {
    // The real driver reports `last: null` for an advance no timer answered.
    const inner = driver();
    const quiet = (live: VizLiveState): VizLiveState => {
      const step = live.steps.at(-1);
      if (step?.kind === "advance" && live.state === "paying")
        return { ...live, last: null, after: [] };
      if (step?.kind === "event" && step.event === "paymentTimeout")
        return {
          ...live,
          last: {
            from: "paying",
            event: "paymentTimeout",
            to: "error",
            outcome: "transition",
            effects: [],
            sent: [],
            context: null,
            error: null,
          },
        };
      return live;
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      {
        driver: { ...inner, reset: () => quiet(inner.reset()), step: (s) => quiet(inner.step(s)) },
        steps: ['submit={"amount":5}', "@300", "paymentTimeout"],
      },
    );
    expect(
      [...root.querySelectorAll("[data-step] [data-live-outcome]")].map((p) => p.textContent),
    ).toEqual([
      "Step 1 of 3: submit: idle → paying",
      "Step 2 of 3: time passed 300 ms",
      "Step 3 of 3: paymentTimeout: paying → error",
    ]);
    expect(root.querySelector('[data-step="2"]')?.textContent).not.toContain("paymentTimeout");
  });

  test("a timer clicked on the board that fires nothing keeps its own row and the next step keeps its own", () => {
    // The real driver reports `last: null` for an advance no timer answered.
    const steps: VizStep[] = [];
    const view = (last: VizLiveStep | null): VizLiveState => ({
      state: "idle",
      steps: [...steps],
      last,
      after: [],
      timers: [{ id: "t1", ms: 100, deadline: 100, eventName: "paymentTimeout" }],
      context: null,
      payload: null,
      regions: {},
      children: [],
      effectMode: "real",
      waiting: [],
    });
    const quiet: VizDriver = {
      reset: () => {
        steps.length = 0;
        return view(null);
      },
      step: (step) => {
        steps.push(step);
        if (step.kind === "advance") return view(null);
        return view({
          from: "idle",
          event: "submit",
          to: "idle",
          outcome: "stay",
          effects: [],
          sent: [],
          context: null,
          error: null,
        });
      },
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      { driver: quiet },
    );
    sendSubmit(root);
    click(root, "[data-advance-timer]");
    sendSubmit(root);
    expect(
      [...root.querySelectorAll("[data-step] [data-live-outcome]")].map((p) => p.textContent),
    ).toEqual([
      "Step 1 of 3: submit: stayed in idle",
      "Step 2 of 3: time passed 100 ms",
      "Step 3 of 3: submit: stayed in idle",
    ]);
    expect(root.querySelector('[data-step="2"] [data-live-after]')).toBeNull();
  });

  test("the timer label counts down the time already advanced", () => {
    const { root } = mount({ steps: ['submit={"amount":5}', "@300"] });
    expect(current(root)).toBe("paying");
    expect(root.querySelector("[data-advance-timer]")?.textContent).toBe(
      "advance 500 ms → paymentTimeout",
    );
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

  test("no state click or ? sends", () => {
    const { root, live } = mount();
    const targets = [...root.querySelectorAll(".graph [data-details-edge], .graph [data-node-id]")];
    expect(targets.length).toBeGreaterThan(0);
    const before = current(root);
    for (const target of targets) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(current(root)).toBe(before);
      expect(live.log).toHaveLength(0);
      expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    }
  });

  test("arrowClickedSending: a click on a next arrow sends, selects it and keeps the tab", () => {
    const { root, live } = mount();
    const arrow = () => root.querySelector('[data-edge-id="idle-submit-paying"]');
    const tab = root.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tab");
    clickArrow(root, "idle-submit-paying");
    expect(live.log).toHaveLength(1);
    expect(current(root)).toBe("paying");
    expect(arrow()?.classList.contains("selected")).toBe(true);
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tab")).toBe(
      tab,
    );
    root.querySelector<HTMLElement>('[data-tab="details"]')?.click();
    expect(root.querySelector("[data-details-sent]")).not.toBeNull();
  });

  test("a keyboard Enter on a next arrow sends and focus stays on it", () => {
    const { root, live } = mount();
    document.body.append(root);
    const arrow = root.querySelector<SVGElement>('[data-edge-id="idle-submit-paying"]');
    arrow?.focus();
    arrow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(live.log).toHaveLength(1);
    expect(document.activeElement?.getAttribute("data-edge-id")).toBe("idle-submit-paying");
    root.remove();
  });

  test("arrowClickedShowingWhyNot: an arrow from another state opens Details with the line, sends nothing", () => {
    const { root, live } = mount();
    clickArrow(root, "paying-paymentTimeout-error");
    expect(live.log).toHaveLength(0);
    expect(current(root)).toBe("idle");
    expect(root.querySelector('[data-tab="details"][aria-selected="true"]')).not.toBeNull();
    expect(root.querySelector("[data-blocked-note]")?.textContent).toBe(
      "paymentTimeout can't be sent: the walk is in idle, this arrow leaves paying.",
    );
  });

  test("timerArrow: a click on a running timer's arrow sends it now; its Details say it fires on its own", () => {
    const { root, live } = mount();
    clickArrow(root, "idle-submit-paying");
    expect(current(root)).toBe("paying");
    clickEdge(root, "paying-paymentTimeout-error");
    expect(root.querySelector("[data-timer-line]")?.textContent).toBe(
      "paymentTimeout fires on its own in 800 ms; a click sends it now.",
    );
    expect(live.log).toHaveLength(1);
    clickArrow(root, "paying-paymentTimeout-error");
    expect(current(root)).toBe("error");
    expect(live.log).toHaveLength(2);
  });

  test("timerArrow: no running timer, no line", () => {
    const { root } = mount();
    clickEdge(root, "paying-paymentTimeout-error");
    expect(root.querySelector("[data-timer-line]")).toBeNull();
    clickEdge(root, "idle-submit-paying");
    expect(root.querySelector("[data-timer-line]")).toBeNull();
  });

  test("timerArrow: the line counts down from the walk's clock", () => {
    const { root } = mount({ steps: ['submit={"amount":5}', "@300"] });
    clickEdge(root, "paying-paymentTimeout-error");
    expect(root.querySelector("[data-timer-line]")?.textContent).toBe(
      "paymentTimeout fires on its own in 500 ms; a click sends it now.",
    );
  });

  test("timerArrow: only the arrow a click would send carries the line", () => {
    const root = document.createElement("div");
    const live = driver();
    const machine = {
      ...checkout,
      edges: [
        ...checkout.edges,
        edge("idle", "paymentTimeout", "error"),
        edge("paying", "cancel", "idle"),
      ],
      events: [...checkout.events, { id: "cancel", internal: false, doc: null, payload: null }],
    };
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver: live });
    clickArrow(root, "idle-submit-paying");
    clickEdge(root, "paying-cancel-idle");
    expect(root.querySelector("[data-send-edge]")).not.toBeNull();
    expect(root.querySelector("[data-timer-line]")).toBeNull();
    clickEdge(root, "idle-paymentTimeout-error");
    expect(root.querySelector("[data-timer-line]")).toBeNull();
    clickArrow(root, "idle-paymentTimeout-error");
    expect(live.log).toHaveLength(1);
  });

  test("helpClickedShowingDetails: the ? on a next arrow opens Details with Send and sends nothing", () => {
    const { root, live } = mount();
    clickEdge(root, "idle-submit-paying");
    expect(live.log).toHaveLength(0);
    expect(root.querySelector("[data-send-edge]")).not.toBeNull();
  });

  test("an arrow click and a ? leave the page still; a state click brings the panel in", () => {
    const { root } = mount();
    document.body.append(root);
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    clickEdge(root, "idle-submit-paying");
    expect(scroll).toHaveBeenCalledTimes(0);
    clickArrow(root, "paying-paymentTimeout-error");
    expect(scroll).toHaveBeenCalledTimes(0);
    clickArrow(root, "idle-submit-paying");
    expect(scroll).toHaveBeenCalledTimes(0);
    root
      .querySelector<SVGElement>('[data-node-id="paying"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(scroll).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    root.remove();
  });

  test("diagramOnlyNoHelp: no ? is drawn, and an arrow click still sends", () => {
    const { root, live } = mount({ diagramOnly: true });
    expect(root.querySelector("[data-details-edge]")).toBeNull();
    clickArrow(root, "idle-submit-paying");
    expect(live.log).toHaveLength(1);
    clickArrow(root, "idle-submit-paying");
    expect(live.log).toHaveLength(1);
  });

  test.each([[[]], [["submit"]]] as const)(
    "one rule after steps %j: a click on an arrow sends exactly when its ? shows Send",
    (steps) => {
      const ids = [...mount().root.querySelectorAll("[data-details-edge]")].map((each) =>
        each.getAttribute("data-details-edge"),
      );
      expect(ids.length).toBeGreaterThan(0);
      let shownAny = false;
      for (const id of ids) {
        const offered = mount({ steps: [...steps] });
        clickEdge(offered.root, id ?? "");
        const shown = offered.root.querySelector("[data-send-edge]") !== null;
        shownAny ||= shown;
        const sent = mount({ steps: [...steps] });
        const before = sent.live.log.length;
        clickArrow(sent.root, id ?? "");
        expect(sent.live.log.length > before).toBe(shown);
      }
      expect(shownAny).toBe(true);
    },
  );

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

  test("an arrow whose source is not current says why, and after a send only the sent line shows", () => {
    const { root } = mount();
    clickEdge(root, "paying-paymentTimeout-error");
    expect(root.querySelector("[data-blocked-note]")?.textContent).toBe(
      "paymentTimeout can't be sent: the walk is in idle, this arrow leaves paying.",
    );
    clickEdge(root, "idle-submit-paying");
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    clickEdge(root, "idle-submit-paying");
    expect(root.querySelector("[data-details-sent]")).not.toBeNull();
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
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
  /** The box of the submit arrow's send form; its `?` opens the form. */
  interface BoxOptions {
    field: string;
  }
  function valueBox(root: HTMLElement, options: BoxOptions): HTMLInputElement | undefined {
    clickEdge(root, "idle-submit-paying");
    const selector = `[data-send-form] [data-value="${options.field}"]`;
    return root.querySelector<HTMLInputElement>(selector) ?? undefined;
  }
  interface SetBoxOptions {
    field: string;
    text: string;
  }
  function setBox(root: HTMLElement, options: SetBoxOptions): void {
    const box = valueBox(root, options);
    if (box) box.value = options.text;
    box?.dispatchEvent(new Event("change", { bubbles: true }));
  }

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

  test("a value changed in the send form is sent by every later click, kept for onNavigate and across Back", () => {
    const seen: string[][] = [];
    const { root, live } = mountFields(requiredMachine, {
      onNavigate: (where) => seen.push(where.payloads),
    });
    const prefilled = valueBox(root, { field: "amount" })?.value;
    setBox(root, { field: "amount", text: "7.5" });
    const changed = seen.at(-1);
    sendSubmit(root);
    const sent = seen.at(-1);
    click(root, '[data-explore-action="back"]');
    const afterBack = valueBox(root, { field: "amount" })?.value;
    sendSubmit(root);
    const step = { kind: "event", event: "submit", payload: { amount: 7.5, label: "hi" } };
    expect({ prefilled, changed, sent, afterBack, log: live.log }).toEqual({
      prefilled: "1",
      changed: ['submit={"amount":7.5}'],
      sent: ['submit={"amount":7.5}'],
      afterBack: "7.5",
      log: [[step], [step]],
    });
  });

  test("a send form row reads the field name only, with no type text", () => {
    const { root } = mountFields(requiredMachine);
    clickEdge(root, "idle-submit-paying");
    const rows = [...root.querySelectorAll(".explore-field")].map((row) => row.textContent?.trim());
    expect(rows).toEqual(["amount", "label"]);
  });

  test("values from an old address are sent, and clearing the box sends the example again", () => {
    const { root, live } = mountFields(requiredMachine, { values: ['label="from url"', "bad"] });
    const label = valueBox(root, { field: "label" })?.value;
    setBox(root, { field: "amount", text: "2" });
    setBox(root, { field: "amount", text: "" });
    sendSubmit(root);
    expect({ label, sent: live.log[0] }).toEqual({
      label: "from url",
      sent: [{ kind: "event", event: "submit", payload: { amount: 1, label: "from url" } }],
    });
  });

  test("text that is not a value puts the prefill back in the box, and the prefill is sent", () => {
    const { root, live } = mountFields(requiredMachine);
    setBox(root, { field: "amount", text: "7" });
    setBox(root, { field: "amount", text: "seven" });
    const amount = valueBox(root, { field: "amount" })?.value;
    sendSubmit(root);
    expect({ amount, sent: live.log[0] }).toEqual({
      amount: "1",
      sent: [{ kind: "event", event: "submit", payload: { amount: 1, label: "hi" } }],
    });
  });

  test("a typed default is kept and sent", () => {
    const seen: string[][] = [];
    const { root } = mountFields(requiredMachine, {
      onNavigate: (where) => seen.push(where.payloads),
    });
    setBox(root, { field: "amount", text: "1" });
    expect({ seen: seen.at(-1), amount: valueBox(root, { field: "amount" })?.value }).toEqual({
      seen: ['submit={"amount":1}'],
      amount: "1",
    });
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
    const shown = valueBox(root, { field: "label" })?.value;
    sendSubmit(root);
    expect({ label: shown, sent: live.log[0] }).toEqual({
      label: "hi",
      sent: [{ kind: "event", event: "submit", payload: { amount: 1, label: "hi" } }],
    });
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

  test("a root output shows once, with where the app takes it when the page knows", () => {
    const routes: VizOutputRoutes = {
      [branching.id]: { openAlbum: [{ to: "router", event: "NAVIGATED", at: "a.ts:72" }] },
    };
    const send = (root: HTMLElement) => {
      sendVia(root, "submit");
    };
    const routed = mountWith(branching, stepped({ sent: ["openAlbum"] }).live, routes);
    send(routed);
    expect(text(routed, "sent")).toBe("checkout sent openAlbum out: router takes NAVIGATED");

    const bare = mountWith(branching, stepped({ sent: ["openAlbum"] }).live);
    send(bare);
    expect(text(bare, "sent")).toBe("checkout sent openAlbum out");

    const quiet = mountWith(branching, stepped({}).live, routes);
    send(quiet);
    expect(quiet.querySelector("[data-live-sent]")).toBeNull();
  });

  test("an output a message row already carries is not listed again", () => {
    const routes: VizOutputRoutes = {
      [branching.id]: { openAlbum: [{ to: "router", event: "NAVIGATED", at: "a.ts:72" }] },
    };
    const taken: VizLiveStep = {
      from: "idle",
      event: "NAVIGATED",
      to: "paying",
      outcome: "transition",
      actor: { region: "router" },
      effects: [],
      sent: [],
      context: { amount: 9 },
      error: null,
      message: { sender: "", dropped: null },
    };
    const root = mountWith(branching, stepped({ sent: ["openAlbum"] }, [taken]).live, routes);
    sendVia(root, "submit");
    expect(root.querySelector("[data-live-sent]")).toBeNull();
    expect(text(root, "after")).toBe("checkout sent NAVIGATED to router: idle → paying");
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
    expect(after?.textContent).toBe("checkout took paymentTimeout on its own: paying → error");
  });

  test("a message with no sender reads `took`, without `on its own`", () => {
    const root = mountWith(
      branching,
      stepped({}, [
        {
          from: "idle",
          event: "NAVIGATED",
          to: "paying",
          outcome: "transition",
          effects: [],
          sent: [],
          context: { amount: 9 },
          error: null,
          message: { sender: null, dropped: null },
        },
      ]).live,
    );
    sendVia(root, "submit");
    expect(text(root, "after")).toBe("checkout took NAVIGATED: idle → paying");
  });

  test("an advance's own message is listed once and draws its output once", () => {
    const inner = driver();
    const message: VizLiveStep = {
      from: "paying",
      event: "paymentTimeout",
      to: "error",
      outcome: "transition",
      effects: [],
      sent: ["openAlbum"],
      context: null,
      error: null,
      message: { sender: "", dropped: null },
    };
    const timed = (live: VizLiveState): VizLiveState => {
      const step = live.steps.at(-1);
      if (step?.kind === "advance") return { ...live, last: message, after: [] };
      return live;
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      {
        driver: { ...inner, reset: () => timed(inner.reset()), step: (s) => timed(inner.step(s)) },
        steps: ['submit={"amount":5}', "@800", 'submit={"amount":5}'],
      },
    );
    const second = root.querySelector('[data-step="2"]');
    expect(second?.querySelectorAll("[data-live-sent]")).toHaveLength(1);
    expect(second?.querySelectorAll("[data-live-after]")).toHaveLength(1);
  });

  test("an output named like a row that carries no message is still shown", () => {
    const inner = driver();
    const own: VizLiveStep = {
      from: "paying",
      event: "paymentTimeout",
      to: "error",
      outcome: "transition",
      effects: [],
      sent: ["paymentTimeout"],
      context: null,
      error: null,
    };
    const timed = (live: VizLiveState): VizLiveState => {
      const step = live.steps.at(-1);
      if (step?.kind === "advance") return { ...live, last: own, after: [] };
      return live;
    };
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [checkout] },
      {
        driver: { ...inner, reset: () => timed(inner.reset()), step: (s) => timed(inner.step(s)) },
        steps: ['submit={"amount":5}', "@800"],
      },
    );
    const second = root.querySelector('[data-step="2"]');
    expect(second?.querySelector("[data-live-after]")?.textContent).toContain("on its own");
    expect(
      [...(second?.querySelectorAll("[data-live-sent]") ?? [])].map((p) => p.textContent),
    ).toEqual(["checkout sent paymentTimeout out"]);
  });

  test("Details after a send to a part that is not there says nothing ran", () => {
    const root = mountWith(
      branching,
      stepped({ outcome: "missing", actor: { region: "ghost" } }).live,
    );
    clickEdge(root, "idle-submit-paying");
    root.querySelector<HTMLButtonElement>("[data-send-edge]")?.click();
    expect(root.querySelector("[data-details-sent]")?.textContent).toBe(
      'Sent submit with {"amount":5}: No region ghost in this machine. Nothing ran.',
    );
  });

  test("an ignored event says nothing ran", () => {
    const root = mountWith(branching, stepped({ to: "idle", outcome: "ignored" }).live);
    sendVia(root, "submit");
    expect(text(root, "outcome")).toBe("! Step 1 of 1: submit: lost, nobody took it in idle");
    expect(root.querySelector("[data-live-outcome][data-live-dropped]")).not.toBeNull();
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
      messages: [],
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
  test("Back resets the driver exactly once", () => {
    const inner = fetchDriver("real");
    let resets = 0;
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [fetcher] },
      {
        driver: {
          ...inner,
          reset: () => {
            resets += 1;
            return inner.reset();
          },
        },
      },
    );
    sendVia(root, "start");
    sendVia(root, "fetchFailed");
    const before = resets;
    click(root, '[data-explore-action="back"]');
    expect(resets - before).toBe(1);
  });

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

    test("a step into fetching names the effect it did not run", () => {
      const root = mountFetcher({ mode: "held" });
      expect(line(root, "not-run")).toBe("Not run here: fetchList");
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
      expect(line(root, "outcome")).toBe("Step 1 of 1: start: waiting → fetching");
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
      expect(line(root, "not-run")).toBe("Not run here: fetchList; logVisit");
      expect(
        [...root.querySelectorAll("[data-live-not-run] code")].map((each) => each.textContent),
      ).toEqual(["fetchList", "logVisit"]);
    });

    test("real mode has no Not run here line", () => {
      const root = mountFetcher({ mode: "real" });
      expect(root.querySelector("[data-live-not-run]")).toBeNull();
      expect(root.querySelector("[data-live-effects]")).toBeNull();
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
      expect(root.querySelector(".explore-now")).toBeNull();
      expect(root.querySelector(".explore")?.hasAttribute("data-done")).toBe(true);
    });

    test("picking a report moves on and Back returns to the state", () => {
      const root = mountFetcher({ mode: "held" });
      sendVia(root, "fetchFailed");
      expect(current(root)).toBe("couldNotFetch");
      click(root, '[data-explore-action="back"]');
      expect(current(root)).toBe("fetching");
    });
  });

  test("at rest the Step tab has no Send buttons, no fold and, without timers, no time block", () => {
    const root = mountFetcher();
    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector(".explore [data-send]")).toBeNull();
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
  test("the Step tab shows no state doc; a sendable arrow's Details are title, send form, doc", () => {
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
        child.getAttribute("data-send-form") ??
        child.getAttribute("data-doc") ??
        child.tagName.toLowerCase(),
    );
    expect(children).toEqual(["h2", "idle-submit-paying", "edge"]);
  });
});
