import { describe, expect, test } from "vite-plus/test";
import { edgeOf, machineOf, stateOf } from "./groups/shop-machines.ts";
import { Either } from "@mantaq/utils";
import { flowFor } from "./graph.ts";
import { foldGroups } from "./groups/fold-groups.ts";
import { groupMachine } from "./groups/group-machine.ts";
import { layoutMachine } from "./layout.ts";
import type { VizMachine } from "../schema.ts";

/** An order whose payment group has a retry loop and two ways out, like the group guide's. */
const order = machineOf({
  states: [
    stateOf("reviewing", { initial: true }),
    stateOf("chargingCard", { group: "payment" }),
    stateOf("confirmingWithBank", { group: "payment" }),
    stateOf("cardDeclined", { group: "payment" }),
    stateOf("packing"),
    stateOf("cancelled", { final: true }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "reviewing", kind: "initial" }),
    edgeOf("reviewing", { event: "placeOrder", to: "chargingCard" }),
    edgeOf("chargingCard", { event: "declined", to: "cardDeclined" }),
    edgeOf("chargingCard", { event: "bankAskedToConfirm", to: "confirmingWithBank" }),
    edgeOf("chargingCard", { event: "charged", to: "packing" }),
    edgeOf("confirmingWithBank", { event: "confirmed", to: "packing" }),
    edgeOf("confirmingWithBank", { event: "declined", to: "cardDeclined" }),
    edgeOf("cardDeclined", { event: "retryCard", to: "chargingCard" }),
    edgeOf("cardDeclined", { event: "cancelOrder", to: "cancelled" }),
  ],
});

function paymentOf(machine: VizMachine): VizMachine {
  const entered = groupMachine(machine, { group: "@payment" });
  if (entered === undefined) throw new Error("no payment group");
  return entered;
}

describe("a layout whose ranks run down", () => {
  test("is narrower than across, draws nothing over anything, and leads each arrow down from its rank", () => {
    const payment = paymentOf(order);
    const across = Either.getRight(layoutMachine(payment));
    const down = Either.getRight(layoutMachine(payment, { flow: "down" }));
    const nodes = new Map<string, { y: number }>();
    for (const node of down?.layout.nodes ?? []) nodes.set(node.id, node);
    const downward: string[] = [];
    for (const placed of down?.layout.edges ?? []) {
      const source = nodes.get(placed.edge.from)?.y ?? Infinity;
      const target = nodes.get(placed.target)?.y ?? -Infinity;
      if (target > source) downward.push(placed.edge.id);
    }
    const folded = Either.getRight(layoutMachine(foldGroups(order), { flow: "down" }));
    const entry = folded?.layout.entries[0];
    const start = nodes.get("reviewing");
    expect({
      overlaps: down?.overlaps,
      narrower: (down?.layout.width ?? Infinity) < (across?.layout.width ?? 0),
      downward: downward.sort(),
      entryFromAbove:
        entry !== undefined && entry.to.x === entry.from.x && entry.to.y > entry.from.y,
      startOnTop: [...nodes.values()].every((node) => node.y >= (start?.y ?? Infinity)),
      labelsAcross: (down?.layout.edges ?? []).every(
        (placed) => placed.label.width > placed.label.height,
      ),
    }).toStrictEqual({
      overlaps: [],
      narrower: true,
      downward: [
        "cardDeclined-cancelOrder-cancelled",
        "chargingCard-bankAskedToConfirm-confirmingWithBank",
        "chargingCard-charged-packing",
        "chargingCard-declined-cardDeclined",
        "confirmingWithBank-confirmed-packing",
        "confirmingWithBank-declined-cardDeclined",
        "reviewing-placeOrder-chargingCard",
      ],
      entryFromAbove: true,
      startOnTop: true,
      labelsAcross: true,
    });
  });

  test("runs only where its drawing holds: a machine with regions is laid out across", () => {
    const regional: VizMachine = { ...order, regions: ["shop"] };
    const across = Either.getRight(layoutMachine(regional))?.layout.width;
    const asked = Either.getRight(layoutMachine(regional, { flow: "down" }))?.layout.width;
    expect(asked).toBe(across);
  });
});

describe("the flow a canvas gets", () => {
  test("across while it fits or the canvas has no width, down when across is too wide and down is narrower", () => {
    const payment = paymentOf(order);
    const across = Either.getRight(layoutMachine(payment))?.layout.width ?? 0;
    expect({
      unmeasured: flowFor(payment, {}),
      roomy: flowFor(payment, { room: across }),
      narrow: flowFor(payment, { room: across - 1 }),
      regions: flowFor({ ...payment, regions: ["shop"] }, { room: 1 }),
    }).toStrictEqual({ unmeasured: "across", roomy: "across", narrow: "down", regions: "across" });
  });
});
