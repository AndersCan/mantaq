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
import { sendVia } from "./send-via.ts";

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

const sendEvent = sendVia;

function eventName(step: VizStep): string {
  return step.kind === "event" ? step.event : step.kind;
}

/** The `?` beside an arrow: opens its Details without sending. */
const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`[data-details-edge="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function mount(driver: VizDriver, machine: VizMachine = cart) {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
  return root;
}

describe("with only the diagram shown", () => {
  function mountDiagram(driver: VizDriver) {
    const root = document.createElement("div");
    mountViewer(
      root,
      { schemaVersion: VIZ_SCHEMA_VERSION, machines: [cart] },
      { driver, diagramOnly: true },
    );
    return root;
  }
  const clickArrow = (root: HTMLElement, id: string) =>
    root
      .querySelector(`g.edge[data-edge-id="${id}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const line = (root: HTMLElement) => root.querySelector(".viz-main > .blocked-note");

  test("a status line sits under the diagram, empty before any click", () => {
    const root = mountDiagram(fakeDriver().driver);
    expect(line(root)?.getAttribute("role")).toBe("status");
    expect(line(root)?.textContent).toBe("");
    expect(root.querySelector(".panel")).toBeNull();
  });

  test("a blocked arrow is no button: a click sends nothing and its hover title says why", () => {
    const { driver, sent } = fakeDriver();
    const root = mountDiagram(driver);
    const pay = root.querySelector('g.edge[data-edge-id="cart-pay-payment"]');
    clickArrow(root, "cart-pay-payment");
    expect({
      sent: sent.map(eventName),
      button: pay?.getAttribute("role") === "button",
      title: pay?.querySelector(":scope > title")?.textContent,
      line: line(root)?.textContent,
      controls: root.querySelector("[data-show-controls]") !== null,
    }).toEqual({
      sent: [],
      button: false,
      title: "pay is blocked: items is 0",
      line: "",
      controls: true,
    });
  });

  test("a click that sends says the step it took, so a second send of a loop shows too", () => {
    const { driver, sent } = fakeDriver();
    const root = mountDiagram(driver);
    clickArrow(root, "cart-addItem-cart");
    const first = line(root)?.textContent;
    clickArrow(root, "cart-addItem-cart");
    expect({ sent: sent.map(eventName), first, second: line(root)?.textContent }).toEqual({
      sent: ["addItem", "addItem"],
      first: "Step 1: addItem: cart → cart",
      second: "Step 2: addItem: cart → cart",
    });
  });

  test("the ? of a blocked arrow says why, and the arrow keeps its blocked look, unlike an arrow just sent", () => {
    const { driver } = fakeDriver();
    const root = mountDiagram(driver);
    clickEdge(root, "cart-pay-payment");
    const pay = root.querySelector('g.edge[data-edge-id="cart-pay-payment"]');
    const asked = { line: line(root)?.textContent, selected: pay?.classList.contains("selected") };
    clickArrow(root, "cart-addItem-cart");
    const add = root.querySelector('g.edge[data-edge-id="cart-addItem-cart"]');
    expect({ asked, sent: add?.classList.contains("selected") }).toEqual({
      asked: { line: "pay is blocked: items is 0", selected: false },
      sent: true,
    });
  });

  test("Escape clears the line under the diagram, and the arrow it spoke of", () => {
    const { driver } = fakeDriver();
    const root = mountDiagram(driver);
    document.body.append(root);
    clickArrow(root, "cart-addItem-cart");
    const said = line(root)?.textContent;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect({
      said,
      after: line(root)?.textContent,
      selected: root.querySelectorAll(".graph .selected").length,
    }).toEqual({ said: "Step 1: addItem: cart → cart", after: "", selected: 0 });
    root.remove();
  });

  test("without diagramOnly there is no line under the diagram", () => {
    const root = mount(fakeDriver().driver);
    expect(line(root)).toBeNull();
  });
});

describe("a blocked arrow", () => {
  test("is grey with a lock, not a next step, says why to a screen reader, and its ? sends nothing", () => {
    const { driver, sent } = fakeDriver();
    const root = mount(driver);
    const pay = root.querySelector('[data-edge-id="cart-pay-payment"]');
    expect(pay?.classList.contains("blocked")).toBe(true);
    expect(pay?.getAttribute("aria-description")).toBe("pay is blocked: items is 0");
    expect(pay?.classList.contains("next")).toBe(false);
    expect(pay?.querySelector(".blocked-lock")).not.toBeNull();
    clickEdge(root, "cart-pay-payment");
    expect(sent).toHaveLength(0);
  });

  test("with the panel, its ? shows its Details and the arrow keeps its blocked look, unlike an arrow just sent", () => {
    const { driver } = fakeDriver();
    const root = mount(driver);
    function arrow(id: string): Element | null {
      return root.querySelector(`g.edge[data-edge-id="${id}"]`);
    }
    clickEdge(root, "cart-pay-payment");
    const asked = {
      details: root.querySelector("[data-selected-edge]")?.getAttribute("data-selected-edge"),
      help: root
        .querySelector('[data-details-edge="cart-pay-payment"]')
        ?.getAttribute("aria-current"),
      selected: arrow("cart-pay-payment")?.classList.contains("selected"),
    };
    arrow("cart-addItem-cart")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect({ asked, sent: arrow("cart-addItem-cart")?.classList.contains("selected") }).toEqual({
      asked: { details: "cart-pay-payment", help: "true", selected: false },
      sent: true,
    });
  });

  test("a click on a blocked arrow sends nothing: it is no button, and its title says why", () => {
    const { driver, sent } = fakeDriver();
    const root = mount(driver);
    const pay = root.querySelector('[data-edge-id="cart-pay-payment"]');
    pay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect({
      sent: sent.map(eventName),
      current: root.querySelector(".explore")?.getAttribute("data-current"),
      button: pay?.hasAttribute("role") || pay?.hasAttribute("tabindex"),
      title: pay?.querySelector(":scope > title")?.textContent,
    }).toEqual({ sent: [], current: "cart", button: false, title: "pay is blocked: items is 0" });
  });

  test("follows a value changed in its send form, so its lock matches what a send does", () => {
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
    clickEdge(root, "cart-pay-payment");
    const box = root.querySelector<HTMLInputElement>('[data-send-form] [data-value="coupon"]');
    expect(box?.value).toBe("none");
    if (box) box.value = "nope";
    box?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pay()?.classList.contains("blocked")).toBe(true);
    if (box) box.value = "free";
    box?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pay()?.classList.contains("blocked")).toBe(false);
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
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
    expect(pay?.hasAttribute("aria-description")).toBe(false);
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
  test("says why and still offers Send, as a click on the arrow does", () => {
    const { driver } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-pay-payment");
    const note = root.querySelector("[data-blocked-note]");
    expect(note?.getAttribute("data-blocked-note")).toBe("pay");
    expect(note?.textContent?.length).toBeGreaterThan(0);
    expect(root.querySelector("[data-send-edge]")?.textContent).toBe("Send pay");
  });

  test("names the guard's context values and follows an effect result while shown", () => {
    const { driver, arrive } = fakeDriver();
    const root = mount(driver);
    clickEdge(root, "cart-pay-payment");
    expect(root.querySelector("[data-blocked-note]")?.textContent).toBe(
      "pay is blocked: items is 0",
    );
    arrive();
    expect(root.querySelector("[data-blocked-note]")).toBeNull();
    expect(root.querySelector("[data-send-edge]")?.textContent).toBe("Send pay");
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
            ? { ...stayedStep(step), outcome: "transition" as const, to: "photos.sent" }
            : stayedStep(step),
        ),
    };
    const root = document.createElement("div");
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] }, { driver });
    const arrow = () => root.querySelector('[data-edge-id="photos.sending-confirm-photos.sent"]');
    expect(arrow()?.classList.contains("blocked")).toBe(true);
    root
      .querySelector<SVGGElement>('g.child-marker[data-marker-key="p2"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(arrow()?.classList.contains("blocked")).toBe(false);
  });
});
