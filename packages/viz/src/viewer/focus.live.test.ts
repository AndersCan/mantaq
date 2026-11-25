// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { VizDriver, VizLiveState, VizStep } from "../schema.ts";
import { documentOf } from "../validate/embed-document.ts";
import type { EnteredMachine } from "./graph.ts";
import { mountViewer } from "./embed.ts";
import type { ViewerOptions } from "./embed.ts";

const shop = documentOf([
  {
    id: "checkout",
    states: [
      { id: "cart", role: "initial" },
      { id: "paying", machine: "payment" },
      { id: "refunding", machine: "payment" },
      { id: "done", role: "final" },
    ],
    edges: [
      { from: "cart", event: "pay", to: "paying" },
      { from: "paying", event: "paid", to: "done" },
      { from: "done", event: "refund", to: "refunding" },
    ],
  },
  {
    id: "payment",
    states: [
      { id: "card", role: "initial" },
      { id: "verifying", machine: "fraud" },
      { id: "settled", role: "final" },
    ],
    edges: [
      { from: "card", event: "submit", to: "verifying" },
      { from: "verifying", event: "pass", to: "settled" },
    ],
  },
  { id: "fraud", states: [{ id: "scoring", role: "initial" }] },
]);

/** Walks checkout's own arrows; counts every step it is asked to take. */
function checkoutDriver(): VizDriver & { taken: VizStep[] } {
  const taken: VizStep[] = [];
  let steps: VizStep[] = [];
  let state = "cart";
  const checkout = shop.machines[0];
  function liveNow(): VizLiveState {
    return {
      state,
      steps: [...steps],
      last: null,
      after: [],
      timers: [],
      context: {},
      payload: null,
      regions: {},
      children: [],
      effectMode: "held",
      waiting: [],
    };
  }
  return {
    taken,
    reset: () => {
      steps = [];
      state = "cart";
      return liveNow();
    },
    step: (step) => {
      taken.push(step);
      const event = step.kind === "event" ? step.event : "";
      const edge = checkout?.edges.find((each) => each.from === state && each.event === event);
      if (edge !== undefined) {
        state = edge.to ?? state;
        steps = [...steps, step];
      }
      return liveNow();
    },
    listen: () => undefined,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

function mount(options: ViewerOptions = {}): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  mountViewer(root, shop, options);
  return root;
}

function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function escape(element: Element | null | undefined): void {
  element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

interface EnterOptions {
  from: string;
}

function enter(root: HTMLElement, options: EnterOptions): void {
  press(root.querySelector(`.machine-enter[data-enter-state="${options.from}"]`));
}

interface CrumbOptions {
  label: string;
}

function crumb(root: HTMLElement, options: CrumbOptions): Element | undefined {
  const crumbs = [...root.querySelectorAll(".focus-path button")];
  return crumbs.find((button) => button.textContent === options.label);
}

/** What the viewer shows: the machine drawn, its states, the path above it, and the walk. */
function shown(root: HTMLElement) {
  const crumbs = [...root.querySelectorAll(".focus-path button")];
  return {
    drawn: root.querySelector(".canvas svg")?.getAttribute("aria-label"),
    states: [...root.querySelectorAll(".canvas g.state")].map((node) =>
      node.getAttribute("data-node-id"),
    ),
    path: crumbs.map((button) => button.textContent),
    current: root.querySelector(".canvas g.state.current")?.getAttribute("data-node-id"),
    steps: root.querySelectorAll("ol.explore-run > li").length,
  };
}

const atCheckout = {
  drawn: "machine checkout",
  states: ["cart", "paying", "refunding", "done"],
  path: [],
  current: undefined,
  steps: 0,
};

const atPayment = {
  drawn: "machine payment",
  states: ["card", "verifying", "settled"],
  path: ["checkout", "payment"],
  current: undefined,
  steps: 0,
};

describe("entering a machine node", () => {
  test("draws the embedded machine on its own, with the path above the canvas", () => {
    const entered: EnteredMachine[] = [];
    const root = mount({ onEnter: (machine) => entered.push(machine) });
    enter(root, { from: "refunding" });
    expect({ shown: shown(root), entered }).toStrictEqual({
      shown: atPayment,
      entered: [{ machine: "payment", state: "refunding" }],
    });
    expect(root.ownerDocument.activeElement).toBe(crumb(root, { label: "payment" }));
  });

  test("enters again from inside, and a crumb leaves to that machine", () => {
    const root = mount();
    enter(root, { from: "paying" });
    enter(root, { from: "verifying" });
    const deep = shown(root).path;
    press(crumb(root, { label: "checkout" }));
    const control = root.querySelector('.machine-enter[data-enter-state="paying"]');
    expect({ deep, left: shown(root), focused: root.ownerDocument.activeElement }).toStrictEqual({
      deep: ["checkout", "payment", "fraud"],
      left: atCheckout,
      focused: control,
    });
  });

  test("Escape leaves one machine at a time", () => {
    const root = mount();
    enter(root, { from: "paying" });
    enter(root, { from: "verifying" });
    escape(root.querySelector(".focus-path button[aria-current]"));
    const once = shown(root);
    escape(root.querySelector(".canvas svg"));
    const twice = shown(root);
    escape(root.querySelector(".canvas svg"));
    expect({ once, twice, again: shown(root) }).toStrictEqual({
      once: atPayment,
      twice: atCheckout,
      again: atCheckout,
    });
  });

  test("never changes the walk or the step log, and draws the entered machine without it", () => {
    const driver = checkoutDriver();
    const root = mount({ driver });
    press(root.querySelector('g.edge[data-edge-id="cart-pay-paying"]'));
    const walked = shown(root);
    enter(root, { from: "paying" });
    const inside = shown(root);
    press(root.querySelector('.canvas g.edge[data-edge-id="card-submit-verifying"]'));
    const clicked = {
      sent: driver.taken.length,
      details: root.querySelector("[data-selected-edge]")?.getAttribute("data-selected-edge"),
    };
    escape(root.querySelector(".canvas svg"));
    expect({ walked, inside, clicked, left: shown(root) }).toStrictEqual({
      walked: { ...atCheckout, current: "paying", steps: 1 },
      inside: { ...atPayment, steps: 1 },
      clicked: { sent: 1, details: "card-submit-verifying" },
      left: walked,
    });
  });

  test("a state clicked inside opens its Details, not the root's Screen", () => {
    const screen = (live: VizLiveState) => document.createTextNode(`screen of ${live.state}`);
    const root = mount({ driver: checkoutDriver(), screen });
    enter(root, { from: "paying" });
    press(root.querySelector('.canvas g.state[data-node-id="settled"]'));
    const inside = {
      tab: root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      details: root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state"),
    };
    escape(root.querySelector(".canvas svg"));
    expect({
      inside,
      left: root.querySelector("[data-selected-state]") ?? undefined,
    }).toStrictEqual({
      inside: { tab: "Details", details: "settled" },
      left: undefined,
    });
  });

  test("draws the enter control without onEnter", () => {
    const root = mount();
    expect(root.querySelectorAll(".machine-enter")).toHaveLength(2);
  });
});

describe("the path in the address bar", () => {
  test("each move tells the host the path, and leaving clears it", () => {
    const focus: string[][] = [];
    const root = mount({ onNavigate: (where) => focus.push(where.focus) });
    enter(root, { from: "paying" });
    enter(root, { from: "verifying" });
    press(crumb(root, { label: "checkout" }));
    expect(focus).toEqual([["paying"], ["paying", "verifying"], []]);
  });

  test("a link with the path opens that machine", () => {
    const root = mount({ focus: ["paying", "verifying"] });
    expect(shown(root)).toStrictEqual({
      drawn: "machine fraud",
      states: ["scoring"],
      path: ["checkout", "payment", "fraud"],
      current: undefined,
      steps: 0,
    });
  });

  test("a link whose path does not resolve opens as far as it does", () => {
    const root = mount({ focus: ["paying", "nowhere", "verifying"] });
    expect(shown(root)).toStrictEqual(atPayment);
  });

  test("a link without the path opens the machine that no other embeds", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { ...shop, machines: [...shop.machines].reverse() });
    expect(shown(root)).toStrictEqual(atCheckout);
  });
});
