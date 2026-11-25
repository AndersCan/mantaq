import { describe, expect, test } from "vite-plus/test";
import { edgeOf, groupedCheckout, machineOf, stateOf } from "./shop-machines.ts";
import { foldGroups } from "./fold-groups.ts";
import { groupMachine } from "./group-machine.ts";

const grouped = groupedCheckout();

describe("groupMachine", () => {
  test("the payment group keeps its states, stubs its neighbours and its real edges", () => {
    expect(groupMachine(grouped, { group: "@payment" })).toEqual({
      ...grouped,
      initial: null,
      states: [
        stateOf("inCart"),
        stateOf("chargingCard", { hits: 2 }),
        stateOf("confirming", { hits: 1 }),
        stateOf("packing"),
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
    expect(groupMachine(started, { group: "@g" })).toEqual({
      ...started,
      states: [stateOf("a", { initial: true }), stateOf("b")],
    });
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
      states: [stateOf("cart.open"), stateOf("cart.closed")],
      edges: anywhere.edges.slice(0, 1),
    });
  });

  test("a view keeps the messages between its states and to its onAny sources", () => {
    const talking = machineOf({
      regions: ["cart", "seats"],
      maps: ["seats"],
      states: [stateOf("cart.open", { group: "g" }), stateOf("seats.free"), stateOf("seats.taken")],
      edges: [
        edgeOf("cart.open", { event: "book", to: "seats.free" }),
        edgeOf("cart.*", { event: "reset", to: "cart.open" }),
      ],
    });
    const messages = [
      { from: "cart.open", event: "hold", to: "seats.free" },
      { from: "seats.free", event: "reset", to: "cart.*" },
      { from: "cart.open", event: "sit", to: "seats.taken" },
    ];
    const fuzz = { seed: 0, iterations: 0, corpus: [], errors: [], failedExpectations: [] };
    const machine = { ...talking, fuzz: { ...fuzz, expectations: [], messages } };
    expect(groupMachine(machine, { group: "cart.@g" })).toEqual({
      ...machine,
      states: [stateOf("cart.open"), stateOf("seats.free")],
      fuzz: { ...machine.fuzz, messages: messages.slice(0, 2) },
    });
  });

  test("the same group enters to the same machine, from the real machine or its fold", () => {
    expect(groupMachine(foldGroups(grouped), { group: "@shipping" })).toBe(
      groupMachine(grouped, { group: "@shipping" }),
    );
  });

  test("an unknown group has no view", () => {
    expect(groupMachine(grouped, { group: "@nowhere" })).toBeUndefined();
  });
});
