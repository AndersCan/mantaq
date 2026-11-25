// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./shop-machines.ts";
import { mountViewer } from "../viewer.ts";
import { walkDriver } from "./walk-driver.ts";
import { VIZ_SCHEMA_VERSION } from "../../schema.ts";

/** The grouped checkout with a way back: `cancel` leaves either payment state for the cart. */
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
    edgeOf("chargingCard", { event: "cancel", to: "inCart" }),
    edgeOf("confirming", { event: "cancel", to: "inCart" }),
    edgeOf("confirming", { event: "confirmed", to: "packing" }),
    edgeOf("packing", { event: "packed", to: "sent" }),
  ],
});

const CANCEL = "group:@payment>cancel>inCart:transition";

function mount(guarded: ReadonlySet<string> = new Set()) {
  const root = document.createElement("div");
  document.body.append(root);
  const { driver, sent, arrive } = walkDriver(shop, { guarded });
  mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [shop] }, { driver });
  return { root, sent, arrive };
}

interface ArrowQuery {
  id: string;
}

function arrow(root: HTMLElement, options: ArrowQuery): Element | undefined {
  const selector = `.graph g.edge[data-edge-id="${CSS.escape(options.id)}"]`;
  return root.querySelector(selector) ?? undefined;
}

function click(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The drawn node ids marked current, and the drawn arrows a click sends now. */
function marks(root: HTMLElement) {
  const current: string[] = [];
  for (const node of root.querySelectorAll(".graph g.current[data-node-id]")) {
    current.push(node.getAttribute("data-node-id") ?? "");
  }
  const buttons: string[] = [];
  for (const edge of root.querySelectorAll('.graph g.edge[role="button"]')) {
    buttons.push(edge.getAttribute("data-edge-id") ?? "");
  }
  return { state: root.querySelector(".explore")?.getAttribute("data-current"), current, buttons };
}

describe("a grouped machine in the viewer", () => {
  test("is drawn folded: one node per group with its name, its size, its states and an enter control", () => {
    const { root } = mount();
    const nodes: string[] = [];
    for (const node of root.querySelectorAll(".graph g.state[data-node-id]")) {
      nodes.push(node.getAttribute("data-node-id") ?? "");
    }
    const payment = root.querySelector('.graph g.state[data-node-id="@payment"]');
    expect({
      nodes,
      label: payment?.querySelector(":scope > text")?.textContent,
      row: payment?.querySelector(".machine-name")?.textContent,
      states: payment?.getAttribute("data-states"),
      aria: payment?.getAttribute("aria-label"),
      enter: [...root.querySelectorAll(".machine-enter")].map((each) =>
        each.getAttribute("aria-label"),
      ),
    }).toEqual({
      nodes: ["inCart", "@payment", "@shipping"],
      label: "payment",
      row: "2 states",
      states: JSON.stringify(["chargingCard", "confirming"]),
      aria: "group payment, 2 states: chargingCard, confirming",
      enter: ["enter group payment", "enter group shipping"],
    });
  });

  test("a walk enters a group, steps inside it and leaves it, each step a click on a drawn arrow", () => {
    const { root, sent } = mount();
    const seen = [marks(root)];
    click(arrow(root, { id: "inCart-checkout-chargingCard" }));
    seen.push(marks(root));
    click(arrow(root, { id: "chargingCard-charged-confirming" }));
    seen.push(marks(root));
    click(arrow(root, { id: "confirming-confirmed-packing" }));
    seen.push(marks(root));
    const events: string[] = [];
    for (const step of sent) events.push(step.kind === "event" ? step.event : step.kind);
    expect({ seen, events }).toEqual({
      seen: [
        { state: "inCart", current: ["inCart"], buttons: ["inCart-checkout-chargingCard"] },
        {
          state: "chargingCard",
          current: ["@payment"],
          buttons: ["chargingCard-charged-confirming", CANCEL],
        },
        {
          state: "confirming",
          current: ["@payment"],
          buttons: [CANCEL, "confirming-confirmed-packing"],
        },
        { state: "packing", current: ["@shipping"], buttons: ["packing-packed-sent"] },
      ],
      events: ["checkout", "charged", "confirmed"],
    });
  });

  test("a merged arrow sends the member that leaves the current state", () => {
    const { root } = mount();
    click(arrow(root, { id: "inCart-checkout-chargingCard" }));
    click(arrow(root, { id: "chargingCard-charged-confirming" }));
    click(root.querySelector(`.graph g[data-details-edge="${CANCEL}"]`));
    const details = root.querySelector("[data-selected-edge]")?.getAttribute("data-selected-edge");
    click(arrow(root, { id: CANCEL }));
    expect({ details, state: marks(root).state }).toEqual({
      details: "confirming-cancel-inCart",
      state: "inCart",
    });
  });

  test("a merged arrow that leaves no current state says why, on the arrow and in its Details", () => {
    const { root, sent } = mount();
    const cancel = arrow(root, { id: CANCEL });
    click(cancel);
    click(root.querySelector(`.graph g[data-details-edge="${CANCEL}"]`));
    const why =
      "cancel can't be sent: the walk is in inCart, this arrow leaves chargingCard or confirming.";
    expect({
      button: cancel?.hasAttribute("role"),
      title: cancel?.querySelector("title")?.textContent,
      details: root.querySelector(".details [data-blocked-note]")?.textContent,
      steps: sent.length,
    }).toEqual({ button: false, title: why, details: why, steps: 0 });
  });

  test("a group arrow whose guard blocks its member is locked with the reason, and a click sends nothing", () => {
    const { root, sent } = mount(new Set(["confirming-confirmed-packing"]));
    click(arrow(root, { id: "inCart-checkout-chargingCard" }));
    click(arrow(root, { id: "chargingCard-charged-confirming" }));
    const leave = arrow(root, { id: "confirming-confirmed-packing" });
    click(leave);
    expect({
      blocked: leave?.classList.contains("blocked"),
      button: leave?.hasAttribute("role"),
      why: leave?.getAttribute("aria-description"),
      steps: sent.length,
    }).toEqual({
      blocked: true,
      button: false,
      why: "confirmed stays in confirming, not packing",
      steps: 2,
    });
  });

  test("Details of a group arrow lists its real edges, and Details of a group node its states", () => {
    const { root } = mount();
    click(root.querySelector(`.graph g[data-details-edge="${CANCEL}"]`));
    const edges: string[] = [];
    for (const link of root.querySelectorAll("[data-edge-link]")) edges.push(link.textContent);
    const arrowTitle = root.querySelector(".details h2")?.textContent;
    click(root.querySelector('.graph g.state[data-node-id="@payment"]'));
    const states: string[] = [];
    for (const link of root.querySelectorAll("[data-state-link]")) states.push(link.textContent);
    const groupTitle = root.querySelector(".details h2")?.textContent;
    click(root.querySelector('[data-state-link="confirming"]'));
    expect({
      arrowTitle,
      edges,
      groupTitle,
      states,
      state: root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state"),
    }).toEqual({
      arrowTitle: "group payment —cancel→ inCart",
      edges: ["chargingCard —cancel→ inCart", "confirming —cancel→ inCart"],
      groupTitle: "Group payment",
      states: ["chargingCard", "confirming"],
      state: "confirming",
    });
  });

  test("Details of a group node names each arrow end as the canvas does, and lists a move inside the group once", () => {
    const { root } = mount();
    click(root.querySelector('.graph g.state[data-node-id="@payment"]'));
    const rows: Record<string, string[]> = {};
    for (const row of root.querySelectorAll(".details dd")) {
      const links: string[] = [];
      for (const link of row.querySelectorAll("[data-edge-link], [data-state-link]")) {
        links.push(link.textContent);
      }
      rows[row.getAttribute("data-field") ?? ""] = links;
    }
    expect(rows).toStrictEqual({
      states: ["chargingCard", "confirming"],
      outgoing: ["group payment —cancel→ inCart", "group payment —confirmed→ group shipping"],
      incoming: ["inCart —checkout→ group payment"],
      inside: ["group payment —charged→ group payment"],
    });
  });

  test("in a region, Details and the shared node name each state as the canvas draws it", () => {
    const states = [
      stateOf("order.inCart", { initial: true }),
      stateOf("order.chargingCard", { group: "payment" }),
      stateOf("order.confirming", { group: "payment" }),
      stateOf("order.paid"),
      stateOf("order.shipped"),
      stateOf("order.cancelled", { final: true }),
    ];
    const edges = [
      edgeOf("order.inCart", { event: "checkout", to: "order.chargingCard" }),
      edgeOf("order.confirming", { event: "confirmed", to: "order.paid" }),
    ];
    for (const from of ["order.inCart", "order.chargingCard", "order.confirming", "order.paid"]) {
      edges.push(edgeOf(from, { event: "abort", to: "order.cancelled" }));
    }
    const order = machineOf({ regions: ["order"], states, edges });
    const root = document.createElement("div");
    document.body.append(root);
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [order] });
    click(root.querySelector('.graph g.state[data-node-id="order.@payment"]'));
    const links: string[] = [];
    for (const link of root.querySelectorAll("[data-edge-link]")) links.push(link.textContent);
    expect({
      links,
      shared: root.querySelector(".graph g.any-node")?.getAttribute("aria-label"),
    }).toStrictEqual({
      links: [
        "group payment —confirmed→ paid",
        "group payment —abort→ cancelled",
        "inCart —checkout→ group payment",
      ],
      shared: "these 3 states: inCart, group payment, paid",
    });
  });

  test("a state picked in Details of a group node rings the group node", () => {
    const { root } = mount();
    click(root.querySelector('.graph g.state[data-node-id="@payment"]'));
    click(root.querySelector('[data-state-link="confirming"]'));
    const ringed: string[] = [];
    for (const node of root.querySelectorAll(".graph g.selected[data-node-id]")) {
      ringed.push(node.getAttribute("data-node-id") ?? "");
    }
    expect({
      ringed,
      details: root.querySelector("[data-selected-state]")?.getAttribute("data-selected-state"),
    }).toStrictEqual({ ringed: ["@payment"], details: "confirming" });
  });

  test("a node that shares an arrow out of a group is current while the walk is inside the group", () => {
    const states = [...shop.states, stateOf("refunding"), stateOf("cancelled", { final: true })];
    const edges = [...shop.edges];
    for (const from of ["inCart", "chargingCard", "confirming", "packing"]) {
      edges.push(edgeOf(from, { event: "abort", to: "cancelled" }));
    }
    const aborting = machineOf({ states, edges });
    const root = document.createElement("div");
    document.body.append(root);
    const { driver } = walkDriver(aborting, { guarded: new Set() });
    mountViewer(root, { schemaVersion: VIZ_SCHEMA_VERSION, machines: [aborting] }, { driver });
    click(arrow(root, { id: "inCart-checkout-chargingCard" }));
    const node = root.querySelector(".graph g.any-node");
    expect({
      current: marks(root).current,
      aria: node?.getAttribute("aria-label"),
      arrow: root.querySelector(".graph g.edge[data-from='*1']")?.getAttribute("aria-label"),
    }).toEqual({
      current: ["@payment", "*1"],
      aria: "these 3 states: inCart, group payment, group shipping",
      arrow: "3 states on abort to cancelled",
    });
  });

  test("the canvas scrolls to the group node that draws the current state", () => {
    const { root, arrive } = mount();
    const canvas = root.querySelector<HTMLElement>(".canvas");
    const shipping = root.querySelector('.graph g.state[data-node-id="@shipping"]');
    if (canvas === null || shipping === null) return;
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "scrollWidth", { value: 6000 });
    shipping.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 3000, y: 0, width: 120, height: 40 });
    arrive(["checkout", "charged", "confirmed"]);
    expect(canvas.scrollLeft).toBe(3000 + 120 + 16 - 300);
  });
});
