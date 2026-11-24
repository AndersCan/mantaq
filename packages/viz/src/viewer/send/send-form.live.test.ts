// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import type {
  VizDriver,
  VizEdge,
  VizField,
  VizJson,
  VizLiveState,
  VizLiveStep,
  VizMachine,
  VizState,
  VizStep,
} from "../../schema.ts";
import { VIZ_SCHEMA_VERSION } from "../../schema.ts";
import { mountViewer } from "../embed.ts";
import type { ViewerOptions } from "../mount/viewer-options.ts";

interface StateOptions {
  initial: boolean;
}

function stateOf(id: string, options: StateOptions): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: options.initial,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

interface FieldOptions {
  input: "text" | "number";
  sample: VizJson;
}

function fieldOf(name: string, options: FieldOptions): VizField {
  const { input, sample } = options;
  return { name, type: input, optional: false, doc: null, input, choices: [], sample };
}

interface EdgeOptions {
  event: string;
  to: string;
  kind: "transition" | "stay";
}

function edgeOf(options: EdgeOptions): VizEdge {
  return {
    id: `cart-${options.event}-${options.to}`,
    from: "cart",
    event: options.event,
    to: options.to,
    kind: options.kind,
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: {
      status: "analyzed",
      location: { file: "cart.ts", line: 1, column: 1 },
      registration: "on",
      branches: [],
      payloadReads: [],
      contextReads: ["items"],
      contextWrites: [],
      readsActorState: false,
      comparisons: [{ source: "context", path: "items", operator: "!==", literal: 0 }],
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
  };
}

/** add stays in cart and counts qty; pay leaves for paid only with the coupon "free". */
const cart: VizMachine = {
  id: "cart",
  initial: "cart",
  regions: [],
  maps: [],
  actors: [],
  states: [stateOf("cart", { initial: true }), stateOf("paid", { initial: false })],
  events: [
    {
      id: "add",
      internal: false,
      doc: null,
      payload: [
        fieldOf("item", { input: "text", sample: "apple" }),
        fieldOf("qty", { input: "number", sample: 1 }),
      ],
    },
    {
      id: "pay",
      internal: false,
      doc: null,
      payload: [fieldOf("coupon", { input: "text", sample: "none" })],
    },
  ],
  outputs: [],
  partOutputs: {},
  context: [fieldOf("items", { input: "number", sample: 0 })],
  edges: [
    edgeOf({ event: "add", to: "cart", kind: "stay" }),
    edgeOf({ event: "pay", to: "paid", kind: "transition" }),
  ],
  runs: [],
  fuzz: null,
};

function fieldsOf(step: VizStep): Record<string, VizJson> {
  const payload = step.kind === "event" ? step.payload : {};
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
}

interface Played {
  live: VizLiveState;
  last: VizLiveStep | undefined;
}

function play(steps: ReadonlyArray<VizStep>): Played {
  let itemCount = 0;
  let at = "cart";
  let last: VizLiveStep | undefined;
  for (const step of steps) {
    if (step.kind !== "event") continue;
    const from = at;
    const fields = fieldsOf(step);
    if (step.event === "add") itemCount += Number(fields["qty"] ?? 0);
    if (step.event === "pay" && fields["coupon"] === "free") at = "paid";
    last = {
      from,
      event: step.event,
      to: at,
      outcome: from === at ? "stay" : "transition",
      effects: [],
      sent: [],
      context: { items: itemCount },
      error: null,
    };
  }
  const live: VizLiveState = {
    state: at,
    steps: [...steps],
    last: last ?? null,
    after: [],
    timers: [],
    context: { items: itemCount },
    payload: null,
    regions: {},
    children: [],
    effectMode: "held",
    waiting: [],
  };
  return { live, last };
}

function fakeDriver(): { driver: VizDriver; sent: VizStep[]; tried: VizStep[] } {
  const sent: VizStep[] = [];
  const tried: VizStep[] = [];
  const driver: VizDriver = {
    reset: () => {
      sent.length = 0;
      return play([]).live;
    },
    step: (step) => {
      sent.push(step);
      return play(sent).live;
    },
    dryRun: (steps) =>
      steps.map((step) => {
        tried.push(step);
        return play([...sent, step]).last ?? null;
      }),
  };
  return { driver, sent, tried };
}

function mount(options: ViewerOptions = {}): HTMLElement {
  const root = document.createElement("div");
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [cart] }, options);
  return root;
}

function press(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

interface ArrowOptions {
  event: string;
}

function clickArrow(root: HTMLElement, options: ArrowOptions): void {
  press(root.querySelector(`g.edge[data-edge-id^="cart-${options.event}-"]`));
}

function openDetails(root: HTMLElement, options: ArrowOptions): void {
  press(root.querySelector(`[data-details-edge^="cart-${options.event}-"]`));
}

interface BoxOptions {
  field: string;
}

function box(root: HTMLElement, options: BoxOptions): HTMLInputElement | undefined {
  const selector = `[data-send-form] [data-value="${options.field}"]`;
  return root.querySelector<HTMLInputElement>(selector) ?? undefined;
}

interface TypeOptions {
  field: string;
  text: string;
}

function type(root: HTMLElement, options: TypeOptions): void {
  const input = box(root, options);
  if (input === undefined) throw new Error(`no ${options.field} box`);
  input.value = options.text;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("a click on an arrow", () => {
  test("sends at once with what the send form shows", () => {
    const { driver, sent } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "add" });
    const shown = [box(root, { field: "item" })?.value, box(root, { field: "qty" })?.value];
    clickArrow(root, { event: "add" });
    expect({ shown, sent }).toEqual({
      shown: ["apple", "1"],
      sent: [{ kind: "event", event: "add", payload: { item: "apple", qty: 1 } }],
    });
  });

  test("on a blocked arrow sends the payload its dry run was tried with", () => {
    const { driver, sent, tried } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "pay" });
    type(root, { field: "coupon", text: "nope" });
    const locked = root.querySelector('g.edge[data-edge-id="cart-pay-paid"]')?.classList;
    const note = root.querySelector("[data-send-form] [data-blocked-note]")?.textContent;
    clickArrow(root, { event: "pay" });
    const step = { kind: "event", event: "pay", payload: { coupon: "nope" } };
    expect({
      blocked: locked?.contains("blocked"),
      note,
      sent,
      tried: tried.some((each) => JSON.stringify(each) === JSON.stringify(step)),
      current: root.querySelector(".explore")?.getAttribute("data-current"),
    }).toEqual({
      blocked: true,
      note: "pay is blocked: items is 0",
      sent: [step],
      tried: true,
      current: "cart",
    });
  });

  test("on the arrow whose values open it takes it", () => {
    const { driver, sent } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "pay" });
    type(root, { field: "coupon", text: "free" });
    const note = root.querySelector("[data-send-form] [data-blocked-note]");
    clickArrow(root, { event: "pay" });
    const at = root.querySelector(".explore")?.getAttribute("data-current");
    expect({ note: note ?? undefined, sent: sent.length, at }).toEqual({
      note: undefined,
      sent: 1,
      at: "paid",
    });
  });
});

describe("the send form", () => {
  test("keeps a change for every later send of the event, and shows the last values used once it is dropped", () => {
    const { driver, sent } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "add" });
    type(root, { field: "qty", text: "3" });
    clickArrow(root, { event: "add" });
    clickArrow(root, { event: "add" });
    openDetails(root, { event: "add" });
    type(root, { field: "qty", text: "" });
    const shown = box(root, { field: "qty" })?.value;
    clickArrow(root, { event: "add" });
    expect({ shown, qty: sent.map((step) => fieldsOf(step)["qty"]) }).toEqual({
      shown: "3",
      qty: [3, 3, 3],
    });
  });

  test("Enter in a box sends the event with the typed value", () => {
    const { driver, sent } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "add" });
    const input = box(root, { field: "item" });
    if (input === undefined) throw new Error("no item box");
    input.value = "pear";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent).toEqual([{ kind: "event", event: "add", payload: { item: "pear", qty: 1 } }]);
  });

  test("a change refills the other boxes in place, so the box typed in stays", () => {
    const { driver } = fakeDriver();
    const root = mount({ driver });
    openDetails(root, { event: "add" });
    const before = box(root, { field: "item" });
    type(root, { field: "qty", text: "2" });
    expect({
      same: box(root, { field: "item" }) === before,
      qty: box(root, { field: "qty" })?.value,
    }).toEqual({
      same: true,
      qty: "2",
    });
  });
});

describe("payloads in the address", () => {
  test("open the send form with them, and onNavigate reports each change", () => {
    const { driver, sent } = fakeDriver();
    const seen: string[][] = [];
    const root = mount({
      driver,
      payloads: ['add={"qty":5}'],
      onNavigate: (where) => seen.push(where.payloads),
    });
    openDetails(root, { event: "add" });
    const shown = box(root, { field: "qty" })?.value;
    type(root, { field: "item", text: "fig" });
    clickArrow(root, { event: "add" });
    expect({ shown, seen: seen.at(-1), sent: sent.map(fieldsOf) }).toEqual({
      shown: "5",
      seen: ['add={"qty":5,"item":"fig"}'],
      sent: [{ item: "fig", qty: 5 }],
    });
  });

  test("an old ?value= sets the field on every event that has it, and a ?payload= wins", () => {
    const { driver } = fakeDriver();
    const root = mount({
      driver,
      values: ['coupon="free"', "qty=4"],
      payloads: ['add={"qty":6}'],
    });
    openDetails(root, { event: "add" });
    const qty = box(root, { field: "qty" })?.value;
    openDetails(root, { event: "pay" });
    const coupon = box(root, { field: "coupon" })?.value;
    const locked = root.querySelector('g.edge[data-edge-id="cart-pay-paid"]');
    expect({ qty, coupon, blocked: locked?.classList.contains("blocked") }).toEqual({
      qty: "6",
      coupon: "free",
      blocked: false,
    });
  });
});
