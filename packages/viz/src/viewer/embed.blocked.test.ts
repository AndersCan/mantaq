// @vitest-environment happy-dom
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

function state(id: string, initial = false): VizState {
  return {
    id,
    label: id,
    region: null,
    initial,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(event: string, to: string, guarded: boolean): VizEdge {
  return {
    id: `cart-${event}-${to}`,
    from: "cart",
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: guarded
      ? {
          status: "analyzed",
          location: { file: "order.ts", line: 1, column: 1 },
          registration: "on",
          branches: [],
          payloadReads: [],
          contextReads: ["items"],
          contextWrites: [],
          readsActorState: false,
          comparisons: [{ source: "context", path: "items", operator: "!==", literal: 0 }],
          literals: [],
        }
      : null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

const cart: VizMachine = {
  id: "cart",
  initial: "cart",
  regions: [],
  maps: [],
  actors: [],
  states: [state("cart", true), state("payment")],
  events: [
    { id: "addItem", internal: false, doc: null, payload: null },
    { id: "pay", internal: false, doc: null, payload: null },
  ],
  outputs: [],
  partOutputs: {},
  context: null,
  edges: [edge("addItem", "cart", false), edge("pay", "payment", true)],
  runs: [],
  fuzz: null,
};

/** items counts addItem steps; pay moves to payment only when items is not 0. */
function fakeDriver(opens: (step: VizStep) => boolean = () => false) {
  const sent: VizStep[] = [];
  let listens = 0;
  let report: ((state: VizLiveState) => void) | undefined;
  const run = (steps: ReadonlyArray<VizStep>): { live: VizLiveState; last: VizLiveStep | null } => {
    let items = 0;
    let at = "cart";
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      if (step.kind !== "event") continue;
      const from = at;
      if (step.event === "addItem") items += 1;
      if (step.event === "pay" && (items > 0 || opens(step))) at = "payment";
      last = {
        from,
        event: step.event,
        to: at,
        outcome: from === at && step.event === "pay" ? "stay" : "transition",
        effects: [],
        sent: [],
        context: { items },
        error: null,
      };
    }
    return {
      last,
      live: {
        state: at,
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
      },
    };
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
    listen: (callback) => {
      report = callback;
    },
    dryRun: (candidates) => {
      listens += 1;
      return candidates.map((candidate) => run([...sent, candidate]).last);
    },
  };
  /** An effect result arrives later: an item is in the cart, nobody clicked. */
  const arrive = () => {
    sent.push({ kind: "event", event: "addItem", payload: null });
    report?.(run(sent).live);
  };
  return { driver, sent, arrive, dryRuns: () => listens };
}

const sendEvent = (root: HTMLElement, event: string) =>
  root
    .querySelector(`[data-send="${event}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function mount(driver: VizDriver, machine: VizMachine = cart) {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return root;
}

describe("a blocked arrow", () => {
  test("is grey with a lock, not a next step, and a click on it sends nothing", () => {
    const { driver, sent } = fakeDriver();
    const root = mount(driver);
    const pay = root.querySelector('[data-edge-id="cart-pay-payment"]');
    expect(pay?.classList.contains("blocked")).toBe(true);
    expect(pay?.getAttribute("aria-disabled")).toBe("true");
    expect(pay?.classList.contains("next")).toBe(false);
    expect(pay?.querySelector(".blocked-lock")).not.toBeNull();
    expect(root.querySelector('[data-node-id="payment"]')?.classList.contains("reachable")).toBe(
      false,
    );
    clickEdge(root, "cart-pay-payment");
    expect(sent).toHaveLength(0);
    expect(root.querySelector(".graph .selected")).not.toBeNull();
  });

  test("follows a value set in the Context tab, so its lock matches what a send does", () => {
    const coupon = {
      name: "coupon",
      type: "string",
      optional: false,
      doc: null,
      input: "text" as const,
      choices: [],
      sample: "none",
    };
    const withCoupon: VizMachine = {
      ...cart,
      events: cart.events.map((each) =>
        each.id === "pay" ? { ...each, payload: [coupon] } : each,
      ),
    };
    const { driver, sent } = fakeDriver(
      (step) => step.kind === "event" && JSON.stringify(step.payload) === '{"coupon":"free"}',
    );
    const root = mount(driver, withCoupon);
    const pay = () => root.querySelector('[data-edge-id="cart-pay-payment"]');
    expect(pay()?.classList.contains("blocked")).toBe(true);
    const box = root.querySelector<HTMLInputElement>('[data-value="coupon"]');
    if (box) box.value = "nope";
    box?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pay()?.classList.contains("blocked")).toBe(true);
    if (box) box.value = "free";
    box?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pay()?.classList.contains("blocked")).toBe(false);
    sendEvent(root, "pay");
    expect(sent).toEqual([{ kind: "event", event: "pay", payload: { coupon: "free" } }]);
  });

  test("loses the lock once the context allows it, and then sends", () => {
    const { driver, sent } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-pay-payment");
    sendEvent(root, "addItem");
    const pay = root.querySelector('[data-edge-id="cart-pay-payment"]');
    expect(pay?.classList.contains("blocked")).toBe(false);
    expect(pay?.hasAttribute("aria-disabled")).toBe(false);
    expect(pay?.querySelector(".blocked-lock")).toBeNull();
    expect(pay?.classList.contains("next")).toBe(true);
    sendEvent(root, "pay");
    expect(sent.map((step) => (step.kind === "event" ? step.event : step.kind))).toEqual([
      "addItem",
      "pay",
    ]);
  });

  test("a driver without dryRun blocks nothing", () => {
    const { driver } = fakeDriver();
    const { dryRun: _unused, ...plain } = driver;
    const root = mount(plain);
    expect(root.querySelector(".blocked")).toBeNull();
  });

  test("a dryRun that throws blocks nothing", () => {
    const root = mount({
      ...fakeDriver().driver,
      dryRun: () => {
        throw new Error("boom");
      },
    });
    expect(root.querySelector(".blocked")).toBeNull();
  });

  test("a null dry-run result blocks nothing", () => {
    const root = mount({ ...fakeDriver().driver, dryRun: (steps) => steps.map(() => null) });
    expect(root.querySelector(".blocked")).toBeNull();
  });

  test("is tried again only when the live state changes", () => {
    const { driver, dryRuns } = fakeDriver();
    const root = mount(driver);
    const once = dryRuns();
    clickEdge(root, "cart-pay-payment");
    expect(dryRuns()).toBe(once);
    sendEvent(root, "addItem");
    expect(dryRuns()).toBe(once + 1);
  });
});

function stateIn(id: string, initial = false): VizState {
  return {
    ...state(id, initial),
    region: id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null,
  };
}

function guardedEdge(
  from: string,
  event: string,
  to: string,
  comparisons: Array<{ path: string; operator: "!==" | ">" | "<"; literal: number }>,
): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: {
      status: "analyzed",
      location: { file: "m.ts", line: 1, column: 1 },
      registration: "on",
      branches: [],
      payloadReads: [],
      contextReads: comparisons.map((each) => each.path),
      contextWrites: [],
      readsActorState: false,
      comparisons: comparisons.map((each) => ({ source: "context" as const, ...each })),
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
  };
}

const eventOf = (id: string) => ({ id, internal: false, doc: null, payload: null });

function liveState(over: Partial<VizLiveState>): VizLiveState {
  return {
    state: "cart",
    steps: [],
    last: null,
    after: [],
    timers: [],
    context: { items: 0 },
    payload: null,
    regions: {},
    children: [],
    effectMode: "held",
    waiting: [],
    ...over,
  };
}

function stayedStep(step: VizStep) {
  return {
    from: "x",
    event: step.kind === "event" ? step.event : "",
    to: "x",
    outcome: "stay" as const,
    effects: [],
    sent: [],
    context: null,
    error: null,
  };
}

describe("a blocked arrow's Details", () => {
  test("says why and has no Send button", () => {
    const { driver } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-pay-payment");
    const note = root.querySelector("[data-blocked-note]");
    expect(note?.getAttribute("data-blocked-note")).toBe("pay");
    expect(note?.textContent?.length).toBeGreaterThan(0);
    expect(root.querySelector("[data-send-edge]")).toBeNull();
  });

  test("an open arrow has the button and no note", () => {
    const { driver } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-addItem-cart");
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    expect(root.querySelector("[data-send-edge]")?.textContent).toBe("Send addItem");
  });
});

describe("a blocked arrow, more cases", () => {
  test("walking to another map child tries its arrows again", () => {
    const machine: VizMachine = {
      id: "queue",
      initial: "showingQueue",
      regions: ["photos"],
      maps: ["photos"],
      actors: [],
      states: [
        stateIn("showingQueue", true),
        stateIn("photos.sending", true),
        stateIn("photos.sent"),
      ],
      events: [eventOf("confirm")],
      outputs: [],
      partOutputs: {},
      context: null,
      edges: [
        guardedEdge("photos.sending", "confirm", "photos.sent", [
          { path: "quota", operator: "!==", literal: 0 },
        ]),
      ],
      runs: [],
      fuzz: null,
    };
    const state0 = liveState({
      state: "showingQueue",
      context: { quota: 0 },
      children: [
        { map: "photos", key: "p1", state: "photos.sending", since: 0 },
        { map: "photos", key: "p2", state: "photos.sending", since: 1 },
      ],
    });
    const driver: VizDriver = {
      reset: () => state0,
      step: () => state0,
      // p1's handler stays, p2's moves on.
      dryRun: (steps) =>
        steps.map((step) =>
          step.kind === "event" &&
          step.actor !== undefined &&
          "key" in step.actor &&
          step.actor.key === "p2"
            ? { ...stayedStep(step), outcome: "transition" as const }
            : stayedStep(step),
        ),
    };
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
    const arrow = () => root.querySelector('[data-edge-id="photos.sending-confirm-photos.sent"]');
    expect(arrow()?.classList.contains("blocked")).toBe(true);
    root.dispatchEvent(
      new CustomEvent("mantaq:pick-child", { bubbles: true, detail: { map: "photos", key: "p2" } }),
    );
    expect(arrow()?.classList.contains("blocked")).toBe(false);
  });
});
