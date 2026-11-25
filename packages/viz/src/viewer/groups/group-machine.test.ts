import { describe, expect, test } from "vite-plus/test";
import { edgeOf, groupedCheckout, machineOf, readEdge, stateOf } from "./shop-machines.ts";
import { edgeLines } from "../labels.ts";
import { layoutMachine } from "../layout.ts";
import { shareArrows } from "../shared.ts";
import type { VizBranch } from "../../schema.ts";
import { foldGroups } from "./fold-groups.ts";
import { groupMachine } from "./group-machine.ts";

const grouped = groupedCheckout();

interface BranchTarget {
  state: string;
}

function branch(conditions: string[], options: BranchTarget): VizBranch {
  return { conditions, target: { kind: "state", state: options.state } };
}

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

  test("an arrow whose partner branch the view leaves out shows its own condition, not else", () => {
    const review = [
      branch(["score < 600"], { state: "review" }),
      branch(["!(score < 600)"], { state: "paying" }),
    ];
    const paid = [branch(["ok"], { state: "free" }), branch(["!(ok)"], { state: "browsing" })];
    const checkout = machineOf({
      regions: ["cart", "seats"],
      maps: ["seats"],
      states: [
        stateOf("cart.browsing", { initial: true }),
        stateOf("cart.review"),
        stateOf("cart.paying", { group: "payment" }),
        stateOf("seats.free"),
      ],
      edges: [
        readEdge(edgeOf("cart.browsing", { event: "checkout", to: "cart.review" }), {
          branches: review,
        }),
        readEdge(edgeOf("cart.browsing", { event: "checkout", to: "cart.paying" }), {
          branches: review,
        }),
        readEdge(edgeOf("cart.paying", { event: "pay", to: "seats.free" }), { branches: paid }),
        readEdge(edgeOf("cart.paying", { event: "pay", to: "cart.browsing" }), { branches: paid }),
      ],
    });
    const view = groupMachine(checkout, { group: "cart.@payment" });
    const labels: string[] = [];
    for (const edge of view?.edges ?? []) labels.push(edgeLines(edge).join(" "));
    const laid = view === undefined ? undefined : layoutMachine(view);
    expect({ labels, overlaps: laid?.[1]?.overlaps }).toStrictEqual({
      labels: ["checkout score >= 600", "pay ok", "pay else"],
      overlaps: [],
    });
  });

  test("an arrow that several outside states share keeps its own condition", () => {
    const lost = [branch(["ok"], { state: "lost" }), branch(["!(ok)"], { state: "paying" })];
    const sources = ["a", "b", "c"];
    const edges = [];
    for (const from of sources) {
      edges.push(readEdge(edgeOf(from, { event: "go", to: "lost" }), { branches: lost }));
      edges.push(readEdge(edgeOf(from, { event: "go", to: "paying" }), { branches: lost }));
    }
    const states = [stateOf("paying", { group: "payment" }), stateOf("lost")];
    for (const id of sources) states.push(stateOf(id));
    const view = groupMachine(machineOf({ states, edges }), { group: "@payment" });
    const labels: string[] = [];
    for (const edge of shareArrows(view ?? machineOf({ states, edges })).edges) {
      labels.push(edgeLines(edge).join(" "));
    }
    expect(labels).toStrictEqual(["go !ok"]);
  });

  test("an unknown group has no view", () => {
    expect(groupMachine(grouped, { group: "@nowhere" })).toBeUndefined();
  });
});
