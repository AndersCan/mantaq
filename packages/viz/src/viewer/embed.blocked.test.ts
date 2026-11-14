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
function fakeDriver() {
  const sent: VizStep[] = [];
  let listens = 0;
  const run = (steps: ReadonlyArray<VizStep>): { live: VizLiveState; last: VizLiveStep | null } => {
    let items = 0;
    let at = "cart";
    let last: VizLiveStep | null = null;
    for (const step of steps) {
      if (step.kind !== "event") continue;
      const from = at;
      if (step.event === "addItem") items += 1;
      if (step.event === "pay" && items > 0) at = "payment";
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
    dryRun: (candidates) => {
      listens += 1;
      return candidates.map((candidate) => run([...sent, candidate]).last);
    },
  };
  return { driver, sent, dryRuns: () => listens };
}

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function mount(driver: VizDriver) {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [cart] }, { driver });
  return root;
}

describe("a blocked arrow", () => {
  test("is grey with a lock, not a next step, and opens the reason without sending", () => {
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
    const note = root.querySelector('[data-blocked-note="pay"]');
    expect(note?.textContent).toBe("pay is blocked: items is 0");
    expect(note?.getAttribute("aria-label")).toBe("pay is blocked: items is 0");
    expect(root.querySelector(".graph .selected")).toBeNull();
  });

  test("Escape closes the note", () => {
    const root = mount(fakeDriver().driver);
    clickEdge(root, "cart-pay-payment");
    root
      .querySelector('[data-blocked-note="pay"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
  });

  test("loses the lock once the context allows it, and then sends", () => {
    const { driver, sent } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-pay-payment");
    clickEdge(root, "cart-addItem-cart");
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    const pay = root.querySelector('[data-edge-id="cart-pay-payment"]');
    expect(pay?.classList.contains("blocked")).toBe(false);
    expect(pay?.hasAttribute("aria-disabled")).toBe(false);
    expect(pay?.querySelector(".blocked-lock")).toBeNull();
    expect(pay?.classList.contains("next")).toBe(true);
    clickEdge(root, "cart-pay-payment");
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
    clickEdge(root, "cart-addItem-cart");
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

describe("a blocked arrow, more cases", () => {
  test("a path compared twice is named once", () => {
    const machine: VizMachine = {
      id: "cart",
      initial: "cart",
      regions: [],
      maps: [],
      actors: [],
      states: [stateIn("cart", true), stateIn("payment")],
      events: [eventOf("pay")],
      outputs: [],
      partOutputs: {},
      context: null,
      edges: [
        guardedEdge("cart", "pay", "payment", [
          { path: "items", operator: ">", literal: 0 },
          { path: "items", operator: "<", literal: 10 },
        ]),
      ],
      runs: [],
      fuzz: null,
    };
    const driver: VizDriver = {
      reset: () => liveState({}),
      step: () => liveState({}),
      dryRun: (steps) => steps.map(stayedStep),
    };
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
    root
      .querySelector('[data-edge-id="cart-pay-payment"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector('[data-blocked-note="pay"]')?.textContent).toBe(
      "pay is blocked: items is 0",
    );
  });

  test("Enter then Escape on the focused element closes the note", () => {
    const machine: VizMachine = {
      id: "cart",
      initial: "cart",
      regions: [],
      maps: [],
      actors: [],
      states: [stateIn("cart", true), stateIn("payment")],
      events: [eventOf("pay")],
      outputs: [],
      partOutputs: {},
      context: null,
      edges: [
        guardedEdge("cart", "pay", "payment", [{ path: "items", operator: "!==", literal: 0 }]),
      ],
      runs: [],
      fuzz: null,
    };
    const driver: VizDriver = {
      reset: () => liveState({}),
      step: () => liveState({}),
      dryRun: (steps) => steps.map(stayedStep),
    };
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
    const pay = root.querySelector<SVGGElement>('[data-edge-id="cart-pay-payment"]');
    pay?.focus();
    pay?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(root.querySelector("[data-blocked-note]")).not.toBeNull();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    root.remove();
  });

  test("picking another map child tries its arrows again", () => {
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
    root
      .querySelector('g.child-marker[data-marker-key="p2"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(arrow()?.classList.contains("blocked")).toBe(false);
  });
});
