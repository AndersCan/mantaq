// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./groups/shop-machines.ts";
import type { ViewerOptions } from "./embed.ts";
import type { EnteredGroup } from "./graph.ts";
import { mountViewer } from "./embed.ts";
import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizDocument } from "../schema.ts";
import { walkDriver } from "./groups/walk-driver.ts";

/** The checkout with its payment and shipping states in groups; `cancel` leaves payment for the cart. */
const shop = machineOf({
  states: [
    stateOf("inCart", { initial: true }),
    stateOf("chargingCard", { group: "payment" }),
    stateOf("confirming", { group: "payment" }),
    stateOf("packing", { group: "shipping" }),
    stateOf("sent", { group: "shipping", final: true }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "inCart", kind: "initial" }),
    edgeOf("inCart", { event: "checkout", to: "chargingCard" }),
    edgeOf("chargingCard", { event: "charged", to: "confirming" }),
    edgeOf("confirming", { event: "cancel", to: "inCart" }),
    edgeOf("confirming", { event: "confirmed", to: "packing" }),
    edgeOf("packing", { event: "packed", to: "sent" }),
  ],
});

const viz: VizDocument = { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shop] };

afterEach(() => {
  document.body.replaceChildren();
});

function mount(options: ViewerOptions = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const { driver, sent } = walkDriver(shop, { guarded: new Set() });
  mountViewer(root, viz, { driver, ...options });
  return { root, sent };
}

/** A click as a browser sends it: the pointer goes down first. */
function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function blur(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function escape(element: Element | null | undefined): void {
  element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

interface Named {
  id: string;
}

function enter(root: HTMLElement, options: Named): void {
  press(root.querySelector(`.machine-enter[data-enter-group="${options.id}"]`));
}

function arrow(root: HTMLElement, options: Named): Element | null {
  return root.querySelector(`.canvas g.edge[data-edge-id="${options.id}"]`);
}

function node(root: HTMLElement, options: Named): Element | null {
  return root.querySelector(`.canvas g[data-node-id="${options.id}"]`);
}

interface CrumbOptions {
  label: string;
}

function crumb(root: HTMLElement, options: CrumbOptions): Element | undefined {
  const crumbs = [...root.querySelectorAll(".focus-path li > *")];
  return crumbs.find((button) => button.textContent === options.label);
}

interface IdsOptions {
  attribute: string;
}

function idsOf(elements: Iterable<Element>, options: IdsOptions): string[] {
  const ids: string[] = [];
  for (const element of elements) ids.push(element.getAttribute(options.attribute) ?? "");
  return ids;
}

/** The drawn nodes and arrows that show the selection ring. */
function ringed(root: HTMLElement): string[] {
  const ids: string[] = [];
  for (const each of root.querySelectorAll(".canvas g.selected:is(.state, .edge)")) {
    ids.push(each.getAttribute("data-node-id") ?? each.getAttribute("data-edge-id") ?? "");
  }
  return ids;
}

/** What the viewer shows: the states drawn, which are stubs, the path above, the walk and what a click sends. */
function shown(root: HTMLElement) {
  const crumbs: string[] = [];
  for (const each of root.querySelectorAll(".focus-path li > *")) crumbs.push(each.textContent);
  return {
    states: idsOf(root.querySelectorAll(".canvas g.state"), { attribute: "data-node-id" }),
    stubs: idsOf(root.querySelectorAll(".canvas g.state.stub"), { attribute: "data-node-id" }),
    path: crumbs,
    current: idsOf(root.querySelectorAll(".canvas g.current[data-node-id]"), {
      attribute: "data-node-id",
    }),
    sends: idsOf(root.querySelectorAll('.canvas g.edge[role="button"]'), {
      attribute: "data-edge-id",
    }),
    outside: root.querySelector(".walk-outside")?.textContent ?? undefined,
  };
}

const atShop = {
  states: ["inCart", "@payment", "@shipping"],
  stubs: [],
  path: [],
  current: ["inCart"],
  sends: ["inCart-checkout-chargingCard"],
  outside: undefined,
};

const inPayment = {
  states: ["inCart", "chargingCard", "confirming", "packing"],
  stubs: ["inCart", "packing"],
  path: ["shop", "payment"],
};

describe("entering a group", () => {
  test("draws its states and a stub for each outside state its arrows reach, with the path above", () => {
    const entered: EnteredGroup[] = [];
    const { root } = mount({ onEnterGroup: (group) => entered.push(group) });
    enter(root, { id: "@payment" });
    const stub = node(root, { id: "packing" });
    expect({
      shown: shown(root),
      entered,
      stub: {
        aria: stub?.getAttribute("aria-label"),
        title: stub?.querySelector(":scope > title")?.textContent,
        button: stub?.getAttribute("role"),
      },
      focused: root.ownerDocument.activeElement === crumb(root, { label: "payment" }),
    }).toStrictEqual({
      shown: {
        ...inPayment,
        current: ["inCart"],
        sends: ["inCart-checkout-chargingCard"],
        outside: "The walk is in inCart, outside group payment.",
      },
      entered: [{ node: "@payment", name: "payment" }],
      stub: {
        aria: "state packing, outside group payment",
        title: "packing is outside group payment. Click to go back and show it there.",
        button: "button",
      },
      focused: true,
    });
  });

  test("the walk goes on inside: each click on a drawn arrow sends, and an arrow to a stub leaves the group", () => {
    const { root, sent } = mount();
    enter(root, { id: "@payment" });
    press(arrow(root, { id: "inCart-checkout-chargingCard" }));
    const charging = shown(root);
    press(arrow(root, { id: "chargingCard-charged-confirming" }));
    const confirming = shown(root);
    press(arrow(root, { id: "confirming-confirmed-packing" }));
    const events: string[] = [];
    for (const step of sent) events.push(step.kind === "event" ? step.event : step.kind);
    expect({ charging, confirming, left: shown(root), events }).toStrictEqual({
      charging: {
        ...inPayment,
        current: ["chargingCard"],
        sends: ["chargingCard-charged-confirming"],
        outside: "",
      },
      confirming: {
        ...inPayment,
        current: ["confirming"],
        sends: ["confirming-cancel-inCart", "confirming-confirmed-packing"],
        outside: "",
      },
      left: {
        ...inPayment,
        current: ["packing"],
        sends: [],
        outside: "The walk is in packing, outside group payment.",
      },
      events: ["checkout", "charged", "confirmed"],
    });
  });

  test("a crumb and Escape go back, onto the enter control", () => {
    const { root } = mount();
    enter(root, { id: "@payment" });
    press(crumb(root, { label: "shop" }));
    const byCrumb = shown(root);
    const control = root.querySelector('.machine-enter[data-enter-group="@payment"]');
    const focusedByCrumb = root.ownerDocument.activeElement === control;
    enter(root, { id: "@payment" });
    escape(root.querySelector(".canvas svg"));
    const byEscape = shown(root);
    escape(root.querySelector(".canvas svg"));
    expect({ byCrumb, focusedByCrumb, byEscape, again: shown(root) }).toStrictEqual({
      byCrumb: atShop,
      focusedByCrumb: true,
      byEscape: atShop,
      again: atShop,
    });
  });

  test("Escape anywhere in the viewer closes an open Details first, then goes back one level", () => {
    const { root } = mount();
    enter(root, { id: "@payment" });
    press(node(root, { id: "confirming" }));
    const opened = root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state");
    escape(root.querySelector('[data-tab="details"]'));
    const closed = { path: shown(root).path, details: root.querySelectorAll(".details").length };
    escape(root.querySelector('[data-tab-panel="details"]'));
    expect({ opened, closed, back: shown(root) }).toStrictEqual({
      opened: "confirming",
      closed: { path: ["shop", "payment"], details: 0 },
      back: atShop,
    });
  });

  test("after a link opens a group, Escape with nothing focused goes back one level", () => {
    const { root } = mount({ focus: ["@payment"] });
    const before = shown(root).path;
    escape(document.body);
    expect({ before, after: shown(root).path }).toStrictEqual({
      before: ["shop", "payment"],
      after: [],
    });
  });

  test("with nothing focused, Escape moves only the viewer a link opened, or the one last touched", () => {
    const first = mount({ focus: ["@payment"] });
    const second = mount({ focus: ["@shipping"] });
    escape(document.body);
    const opened = [shown(first.root).path, shown(second.root).path];
    enter(first.root, { id: "@payment" });
    second.root.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    blur();
    escape(document.body);
    const touched = [shown(first.root).path, shown(second.root).path];
    enter(second.root, { id: "@shipping" });
    first.root.querySelector<HTMLElement>('[data-tab="details"]')?.focus();
    blur();
    escape(document.body);
    expect({
      opened,
      touched,
      focused: [shown(first.root).path, shown(second.root).path],
    }).toStrictEqual({
      opened: [[], ["shop", "shipping"]],
      touched: [["shop", "payment"], []],
      focused: [[], ["shop", "shipping"]],
    });
  });

  test("Escape in the page's own search box does nothing, even when the box drops focus on it", () => {
    const { root } = mount({ focus: ["@payment"] });
    const search = document.createElement("input");
    document.body.append(search);
    search.addEventListener("keydown", () => search.blur());
    search.focus();
    escape(search);
    expect(shown(root).path).toStrictEqual(["shop", "payment"]);
  });

  test("Escape on the host's own screen in the Screen tab does nothing", () => {
    const { root } = mount({
      focus: ["@payment"],
      screen: () => {
        const button = document.createElement("button");
        button.textContent = "Close";
        return button;
      },
    });
    escape(root.querySelector('[data-tab-panel="screen"] button'));
    expect(shown(root).path).toStrictEqual(["shop", "payment"]);
  });

  test("at the top level, with focus lost after a Details link, Escape closes Details", () => {
    const { root } = mount();
    press(node(root, { id: "@payment" }));
    press(root.querySelector('[data-state-link="confirming"]'));
    const lost = document.activeElement === document.body;
    escape(document.body);
    expect({ lost, details: root.querySelectorAll(".details").length }).toStrictEqual({
      lost: true,
      details: 0,
    });
  });

  test("Escape in a text field does nothing, and closing Details moves focus from the panel to its tab", () => {
    const { root } = mount();
    enter(root, { id: "@payment" });
    press(node(root, { id: "confirming" }));
    const field = document.createElement("input");
    root.querySelector(".panel")?.append(field);
    escape(field);
    const typed = root.querySelectorAll(".details").length;
    root.querySelector<HTMLElement>('[data-tab="details"]')?.focus();
    escape(document.activeElement);
    expect({
      typed,
      closed: root.querySelectorAll(".details").length,
      focused: document.activeElement?.getAttribute("data-tab"),
      path: shown(root).path,
    }).toStrictEqual({ typed: 1, closed: 0, focused: "details", path: ["shop", "payment"] });
  });

  test("a stub goes back, onto the node that draws its state, selected with its Details open", () => {
    const { root } = mount();
    enter(root, { id: "@payment" });
    press(node(root, { id: "packing" }));
    expect({
      shown: shown(root),
      focused: root.ownerDocument.activeElement?.getAttribute("data-node-id"),
      ringed: ringed(root),
      details: root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state"),
    }).toStrictEqual({
      shown: atShop,
      focused: "@shipping",
      ringed: ["@shipping"],
      details: "packing",
    });
  });

  test("the arrow just taken keeps its ring when the group is entered and left", () => {
    const { root } = mount();
    press(arrow(root, { id: "inCart-checkout-chargingCard" }));
    const taken = ringed(root);
    enter(root, { id: "@payment" });
    const entered = ringed(root);
    press(arrow(root, { id: "chargingCard-charged-confirming" }));
    escape(root.querySelector(".canvas svg"));
    expect({ taken, entered, left: ringed(root) }).toStrictEqual({
      taken: ["inCart-checkout-chargingCard"],
      entered: ["inCart-checkout-chargingCard"],
      left: ["chargingCard-charged-confirming"],
    });
  });
});

describe("a folded group node", () => {
  function row(root: HTMLElement, options: Named) {
    const group = node(root, options);
    const text = group?.querySelector(".machine-name")?.textContent;
    return { text, description: group?.getAttribute("aria-description") ?? undefined };
  }

  test("names the state of the group the walk is in, and says so when it ended there", () => {
    const { root } = mount();
    const before = row(root, { id: "@payment" });
    press(arrow(root, { id: "inCart-checkout-chargingCard" }));
    const inside = row(root, { id: "@payment" });
    press(arrow(root, { id: "chargingCard-charged-confirming" }));
    press(arrow(root, { id: "confirming-confirmed-packing" }));
    press(arrow(root, { id: "packing-packed-sent" }));
    expect({
      before,
      inside,
      payment: row(root, { id: "@payment" }),
      shipping: row(root, { id: "@shipping" }),
    }).toStrictEqual({
      before: { text: "2 states", description: undefined },
      inside: { text: "now in chargingCard", description: "now in chargingCard" },
      payment: { text: "2 states", description: undefined },
      shipping: { text: "ended in sent", description: "ended in sent" },
    });
  });
});

describe("the path in the address bar", () => {
  test("each move tells the host the path, and leaving clears it", () => {
    const focus: string[][] = [];
    const { root } = mount({ onNavigate: (where) => focus.push(where.focus) });
    enter(root, { id: "@payment" });
    press(crumb(root, { label: "shop" }));
    expect(focus).toEqual([["@payment"], []]);
  });

  test("a link with the path opens the group, and the walk goes on inside it", () => {
    const { root } = mount({ focus: ["@payment"], steps: ["checkout"] });
    expect(shown(root)).toStrictEqual({
      ...inPayment,
      current: ["chargingCard"],
      sends: ["chargingCard-charged-confirming"],
      outside: "",
    });
  });

  test("a link into a group the walk is not near says how to walk on", () => {
    const { root } = mount({ focus: ["@shipping"] });
    expect(shown(root).outside).toBe(
      "The walk is in inCart, outside group shipping. Go back to walk on.",
    );
  });

  test("a link whose path does not resolve opens as far as it does, and the bar says so until the next move or step", () => {
    const { root } = mount({ focus: ["@nowhere", "@payment"] });
    const opened = shown(root);
    const said = root.querySelector('.viz-bar [role="status"].focus-notice')?.textContent;
    enter(root, { id: "@payment" });
    const entered = root.querySelectorAll(".focus-notice").length;
    const walked = mount({ focus: ["@nowhere"] }).root;
    press(arrow(walked, { id: "inCart-checkout-chargingCard" }));
    const empty = mount({ focus: [""] }).root;
    expect({
      opened,
      said,
      entered,
      walked: walked.querySelectorAll(".focus-notice").length,
      empty: empty.querySelectorAll(".focus-notice").length,
    }).toStrictEqual({
      opened: atShop,
      said: 'No group "@nowhere" in shop. The link opens shop. Groups here: @payment, @shipping.',
      entered: 0,
      walked: 0,
      empty: 0,
    });
  });
});
