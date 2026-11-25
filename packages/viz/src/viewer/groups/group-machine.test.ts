import { describe, expect, test } from "vite-plus/test";
import { edgeOf, groupedCheckout, machineOf, stateOf } from "./shop-machines.ts";
import { groupMachine } from "./group-machine.ts";

const grouped = groupedCheckout();

describe("groupMachine", () => {
  test("the payment group keeps its states, stubs its neighbours and its real edges", () => {
    expect(groupMachine(grouped, { group: "@payment" })).toEqual({
      ...grouped,
      initial: null,
      states: [
        stateOf("inCart"),
        grouped.states[1],
        grouped.states[2],
        stateOf("packing", { group: "shipping" }),
      ],
      edges: grouped.edges.slice(1, 4),
    });
  });

  test("a group that holds the start state starts there", () => {
    const started = machineOf({
      states: [stateOf("a", { group: "g", initial: true }), stateOf("b")],
      edges: [
        edgeOf("__initial__", { event: "", to: "a", kind: "initial" }),
        edgeOf("a", { event: "go", to: "b" }),
      ],
    });
    expect(groupMachine(started, { group: "@g" })).toEqual(started);
  });

  test("an onAny edge of the group's region is taken from inside it", () => {
    const anywhere = machineOf({
      regions: ["cart", "help"],
      states: [
        stateOf("cart.open", { group: "g" }),
        stateOf("cart.closed"),
        stateOf("help.idle"),
        stateOf("help.asking"),
      ],
      edges: [
        edgeOf("cart.*", { event: "reset", to: "cart.closed" }),
        edgeOf("help.*", { event: "ask", to: "help.asking" }),
      ],
    });
    expect(groupMachine(anywhere, { group: "cart.@g" })).toEqual({
      ...anywhere,
      regions: ["cart"],
      states: anywhere.states.slice(0, 2),
      edges: anywhere.edges.slice(0, 1),
    });
  });

  test("the same group enters to the same machine", () => {
    expect(groupMachine(grouped, { group: "@shipping" })).toBe(
      groupMachine(grouped, { group: "@shipping" }),
    );
  });

  test("an unknown group has no view", () => {
    expect(groupMachine(grouped, { group: "@nowhere" })).toBeUndefined();
  });
});
