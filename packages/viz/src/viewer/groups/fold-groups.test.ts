import {
  arrowMembersOf,
  drawnNodeOf,
  foldGroups,
  groupArrowsOf,
  groupNodesOf,
} from "./fold-groups.ts";
import { describe, expect, test } from "vite-plus/test";
import { edgeOf, groupedCheckout, machineOf, readEdge, stateOf } from "./shop-machines.ts";
import type { VizEdge, VizMachine } from "../../schema.ts";
import { edgeLines } from "../labels.ts";
import { scopeOf } from "../../schema.ts";

const grouped = groupedCheckout();

function idsOf(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function endsOf(edges: ReadonlyArray<VizEdge>): string[] {
  return edges.map((edge) => {
    const target = edge.to ?? "?";
    return `${edge.id}: ${edge.from} -> ${target}`;
  });
}

describe("foldGroups on the grouped checkout", () => {
  test("each group is one node in the place of its first state", () => {
    expect(foldGroups(grouped).states).toEqual([
      grouped.states[0],
      {
        id: "@payment",
        label: "payment",
        region: null,
        initial: false,
        final: false,
        effects: [],
        coverage: { hits: 3 },
        tested: null,
        doc: null,
      },
      {
        id: "@shipping",
        label: "shipping",
        region: null,
        initial: false,
        final: false,
        effects: [],
        coverage: null,
        tested: null,
        doc: null,
      },
    ]);
  });

  test("each group node lists its real states", () => {
    expect(groupNodesOf(grouped)).toEqual([
      { id: "@payment", name: "payment", scope: "", states: ["chargingCard", "confirming"] },
      { id: "@shipping", name: "shipping", scope: "", states: ["packing", "sent"] },
    ]);
  });

  test("edges inside a group are dropped and crossing ones keep their real id", () => {
    expect(endsOf(foldGroups(grouped).edges)).toEqual([
      "__initial__--inCart: __initial__ -> inCart",
      "inCart-checkout-chargingCard: inCart -> @payment",
      "confirming-confirmed-packing: @payment -> @shipping",
    ]);
    expect(groupArrowsOf(grouped)).toEqual([]);
    expect(arrowMembersOf(grouped, { arrow: "inCart-checkout-chargingCard" })).toEqual([
      grouped.edges[1],
    ]);
  });

  test("a real state maps to the node that draws it", () => {
    const drawn = idsOf(grouped.states).map((state) => drawnNodeOf(grouped, { state }));
    expect(drawn).toEqual(["inCart", "@payment", "@payment", "@shipping", "@shipping"]);
  });

  test("the same machine folds to the same machine", () => {
    expect(foldGroups(grouped)).toBe(foldGroups(grouped));
  });

  test("a machine without groups folds to its own states and edges", () => {
    const plain = machineOf({
      states: [stateOf("idle", { initial: true }), stateOf("busy")],
      edges: [edgeOf("idle", { event: "go", to: "busy" })],
    });
    expect(foldGroups(plain)).toEqual(plain);
  });
});

/** A region `cart` with groups `review` (two states) and `pay` (one), and states outside both. */
const merging = machineOf({
  regions: ["cart"],
  states: [
    stateOf("cart.empty", { initial: true }),
    stateOf("cart.listing", { group: "review" }),
    stateOf("cart.editing", { group: "review" }),
    stateOf("cart.paying", { group: "pay" }),
    stateOf("cart.done", { final: true }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "cart.empty", kind: "initial" }),
    edgeOf("cart.listing", { event: "cancel", to: "cart.empty" }),
    edgeOf("cart.editing", { event: "cancel", to: "cart.empty" }),
    edgeOf("cart.empty", { event: "add", to: "cart.listing" }),
    edgeOf("cart.listing", { event: "pay", to: "cart.paying" }),
    edgeOf("cart.editing", { event: "pay", to: "cart.paying" }),
    edgeOf("cart.editing", { event: "save", to: null }),
    edgeOf("cart.*", { event: "reset", to: "cart.listing" }),
    edgeOf("cart.*", { event: "reset", to: "cart.editing" }),
    edgeOf("cart.paying", { event: "paid", to: "cart.done" }),
    edgeOf("cart.listing", { event: "edit", to: "cart.editing" }),
    edgeOf("cart.editing", { event: "keep", to: "cart.editing", kind: "stay" }),
  ],
});

describe("foldGroups merges crossing edges", () => {
  test("a group node id keeps the region scope", () => {
    expect(idsOf(foldGroups(merging).states)).toEqual([
      "cart.empty",
      "cart.@review",
      "cart.@pay",
      "cart.done",
    ]);
    expect(groupNodesOf(merging).map((node) => scopeOf(node.id))).toEqual(["cart", "cart"]);
    expect(foldGroups(merging).states[1]?.region).toBe("cart");
  });

  test("edges with the same group end, event and other end are one arrow", () => {
    expect(endsOf(foldGroups(merging).edges)).toEqual([
      "__initial__--cart.empty: __initial__ -> cart.empty",
      "group:cart.@review>cancel>cart.empty:transition: cart.@review -> cart.empty",
      "cart.empty-add-cart.listing: cart.empty -> cart.@review",
      "group:cart.@review>pay>cart.@pay:transition: cart.@review -> cart.@pay",
      "cart.editing-save-?: cart.@review -> ?",
      "group:cart.*>reset>cart.@review:transition: cart.* -> cart.@review",
      "cart.paying-paid-cart.done: cart.@pay -> cart.done",
    ]);
  });

  test("an arrow lists its real members, so a click can send the one from the current state", () => {
    const pay = "group:cart.@review>pay>cart.@pay:transition";
    expect(idsOf(arrowMembersOf(merging, { arrow: pay }))).toEqual([
      "cart.listing-pay-cart.paying",
      "cart.editing-pay-cart.paying",
    ]);
    expect(groupArrowsOf(merging).map((arrow) => arrow.drawn.id)).toEqual([
      "group:cart.@review>cancel>cart.empty:transition",
      pay,
      "group:cart.*>reset>cart.@review:transition",
    ]);
    expect(arrowMembersOf(merging, { arrow: "cart.listing-edit-cart.editing" })).toEqual([]);
  });

  test("a stay and a transition with the same ends stay apart", () => {
    const parted = machineOf({
      states: [stateOf("open", { group: "g" }), stateOf("shut", { group: "g" }), stateOf("away")],
      edges: [
        edgeOf("open", { event: "ping", to: "away" }),
        edgeOf("shut", { event: "ping", to: "away", kind: "stay" }),
      ],
    });
    expect(idsOf(foldGroups(parted).edges)).toEqual(["open-ping-away", "shut-ping-away"]);
  });
});

describe("foldGroups labels", () => {
  test("a merged arrow shows no guard that only one member has", () => {
    const guarded = readEdge(edgeOf("listing", { event: "pay", to: "paying" }), {
      branches: [
        { conditions: ["total > 0"], target: { kind: "state", state: "paying" } },
        { conditions: ["!(total > 0)"], target: { kind: "stay" } },
      ],
    });
    const merged = machineOf({
      states: [
        stateOf("listing", { group: "review" }),
        stateOf("editing", { group: "review" }),
        stateOf("paying"),
      ],
      edges: [guarded, edgeOf("editing", { event: "pay", to: "paying" })],
    });
    expect(foldGroups(merged).edges.map((edge) => edgeLines(edge))).toEqual([["pay"]]);
  });

  test("an arrow into a group keeps its condition beside its else", () => {
    const branches = [
      { conditions: ["ready"], target: { kind: "state" as const, state: "listing" } },
      { conditions: ["!(ready)"], target: { kind: "state" as const, state: "paying" } },
    ];
    const split = machineOf({
      states: [stateOf("empty"), stateOf("listing", { group: "review" }), stateOf("paying")],
      edges: [
        readEdge(edgeOf("empty", { event: "pay", to: "listing" }), { branches }),
        readEdge(edgeOf("empty", { event: "pay", to: "paying" }), { branches }),
      ],
    });
    expect(foldGroups(split).edges.map((edge) => edgeLines(edge))).toEqual([
      ["pay", "ready"],
      ["pay", "else"],
    ]);
  });
});

describe("foldGroups keeps the validator's rules", () => {
  test("a group whose node id is a real state id is not folded", () => {
    const clash = machineOf({ states: [stateOf("@g"), stateOf("a", { group: "g" })], edges: [] });
    expect(groupNodesOf(clash)).toEqual([]);
  });

  test("states of an actor map stay ungrouped", () => {
    const mapped = machineOf({
      regions: ["seats"],
      maps: ["seats"],
      states: [stateOf("seats.free", { group: "g" }), stateOf("seats.taken", { group: "g" })],
      edges: [edgeOf("seats.free", { event: "take", to: "seats.taken" })],
    });
    expect(groupNodesOf(mapped)).toEqual([]);
    expect(foldGroups(mapped).edges).toEqual(mapped.edges);
  });

  test("one name in two scopes is two nodes", () => {
    const twice = machineOf({
      regions: ["left", "right"],
      states: [stateOf("left.a", { group: "g" }), stateOf("right.a", { group: "g" })],
      edges: [],
    });
    expect(idsOf(groupNodesOf(twice))).toEqual(["left.@g", "right.@g"]);
  });

  test("a group name with a dot is not folded", () => {
    const dotted = machineOf({ states: [stateOf("a", { group: "x.y" })], edges: [] });
    expect(idsOf(foldGroups(dotted).states)).toEqual(["a"]);
  });

  test("the start state inside a group starts the group node", () => {
    const started = machineOf({
      states: [stateOf("a", { group: "g", initial: true }), stateOf("b")],
      edges: [edgeOf("__initial__", { event: "", to: "a", kind: "initial" })],
    });
    const folded = foldGroups(started);
    expect({
      initial: folded.initial,
      starts: idsOf(folded.states.filter((state) => state.initial)),
      edges: endsOf(folded.edges),
    }).toEqual({ initial: "@g", starts: ["@g"], edges: ["__initial__--a: __initial__ -> @g"] });
  });

  test("messages are drawn between the nodes that draw their ends", () => {
    const talking: VizMachine = {
      ...grouped,
      fuzz: {
        seed: 0,
        iterations: 0,
        corpus: [],
        errors: [],
        failedExpectations: [],
        expectations: [],
        messages: [
          { from: "chargingCard", event: "ship", to: "packing" },
          { from: "packing", event: "note", to: "sent" },
        ],
      },
    };
    expect(foldGroups(talking).fuzz?.messages).toEqual([
      { from: "@payment", event: "ship", to: "@shipping" },
    ]);
  });
});
