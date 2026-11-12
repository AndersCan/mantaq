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
