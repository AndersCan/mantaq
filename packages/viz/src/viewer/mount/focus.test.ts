import { decodeFocus, focusOf, focusTokens, unknownFocusText } from "./focus.ts";
import { describe, expect, test } from "vite-plus/test";
import { edgeOf, groupedCheckout, machineOf, stateOf } from "../groups/shop-machines.ts";
import { foldGroups } from "../groups/fold-groups.ts";
import { groupMachine } from "../groups/group-machine.ts";
import type { VizMachine } from "../../schema.ts";

/** A board: the app's own `idle`, and the machines `stock` and `till` beside it; the till's two payment states are a group. */
function boardMachine(): VizMachine {
  const shop = machineOf({
    states: [
      stateOf("idle", { initial: true }),
      stateOf("stock.counting", { initial: true }),
      stateOf("till.open", { initial: true }),
      stateOf("till.chargingCard", { group: "payment" }),
      stateOf("till.confirming", { group: "payment" }),
    ],
    edges: [
      edgeOf("till.open", { event: "pay", to: "till.chargingCard" }),
      edgeOf("till.chargingCard", { event: "charged", to: "till.confirming" }),
    ],
    regions: ["stock", "till"],
  });
  return { ...shop, id: "app", actors: ["stock", "till"] };
}

describe("the path in the address bar on a board", () => {
  const root = boardMachine();

  test("names a machine of the board, the machine's own by its id, then a group of that machine", () => {
    const own = focusOf(decodeFocus(["app"], { root }), { root });
    const entered = focusOf(decodeFocus(["till", "till.@payment"], { root }), { root });
    const states: string[] = [];
    for (const state of entered.drawn.states) states.push(state.id);
    expect({
      own: { tokens: focusTokens(own.steps), drawn: own.drawn.id, canvas: own.canvas },
      entered: {
        tokens: focusTokens(entered.steps),
        states,
        crumbs: entered.crumbs,
        group: entered.groupNode,
      },
    }).toStrictEqual({
      own: { tokens: ["app"], drawn: "app", canvas: "graph" },
      entered: {
        tokens: ["till", "till.@payment"],
        states: ["till.open", "till.chargingCard", "till.confirming"],
        crumbs: [
          { label: "app", keep: 0 },
          { label: "till", keep: 1 },
          { label: "payment", keep: 2 },
        ],
        group: "till.@payment",
      },
    });
  });

  test("a link that names a machine or a group not there says what it opens instead", () => {
    expect({
      machine: unknownFocusText(["kitchen"], { root }),
      group: unknownFocusText(["till", "till.@refund"], { root }),
      whole: unknownFocusText(["till", "till.@payment"], { root }),
    }).toStrictEqual({
      machine: 'No machine "kitchen" in app. The link opens app. Machines here: app, stock, till.',
      group: 'No group "till.@refund" in till. The link opens till. Groups here: till.@payment.',
      whole: undefined,
    });
  });

  test("inside a machine of the board, a group may also be named by its own id", () => {
    const entered = focusOf(decodeFocus(["till", "@payment"], { root }), { root });
    expect(focusTokens(entered.steps)).toStrictEqual(["till", "till.@payment"]);
  });

  test("a group cannot be entered from the board, only from its machine", () => {
    expect(decodeFocus(["till.@payment"], { root })).toStrictEqual([]);
  });
});

describe("entering a group", () => {
  const root = groupedCheckout();

  test("draws the group's view of the same machine, which has no group to enter again", () => {
    const entered = focusOf(decodeFocus(["@payment", "@shipping"], { root }), { root });
    expect({
      tokens: focusTokens(entered.steps),
      drawn: entered.drawn === groupMachine(root, { group: "@payment" }),
      machine: entered.machine === root,
    }).toStrictEqual({ tokens: ["@payment"], drawn: true, machine: true });
  });

  test("a value that names no group ends the path", () => {
    expect(decodeFocus(["payment", "@payment"], { root })).toStrictEqual([]);
  });
});

describe("the machine the canvas draws", () => {
  test("is the machine itself without groups, and its fold with them", () => {
    const plain = machineOf({ states: [stateOf("idle", { initial: true })], edges: [] });
    const checkout = groupedCheckout();
    expect({
      plain: focusOf([], { root: plain }).drawn === plain,
      grouped: focusOf([], { root: checkout }).drawn === foldGroups(checkout),
    }).toEqual({ plain: true, grouped: true });
  });
});
