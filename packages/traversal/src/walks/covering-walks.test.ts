import { Actor, event, state } from "@mantaq/core";
import type { ActorGraph, GraphEdge, GraphNode } from "../types.ts";
import { coveringWalks, sendableEdges } from "./covering-walks.ts";
import { describe, expect, test } from "vite-plus/test";
import { buildGraph } from "../graph.ts";

interface NodeOptions {
  kind: "final" | "any" | "initial";
}

function node(id: string, options?: NodeOptions): GraphNode {
  return {
    id,
    label: id,
    isActive: false,
    isFinal: options?.kind === "final",
    ...(options?.kind === "any" && { isAny: true }),
    ...(options?.kind === "initial" && { isInitial: true }),
  };
}

function edge(id: string, flags: Partial<GraphEdge> = {}): GraphEdge {
  const [source = "", label = "", target = ""] = id.split(">");
  return { id, source, target, label, isActive: false, contexts: [], ...flags };
}

/** cart -ADD-> cart, cart -PAY-> paid, cart -DROP-> dropped, paid -SHIP-> shipped. */
function checkoutGraph(): ActorGraph {
  return {
    nodes: [
      node("__initial__", { kind: "initial" }),
      node("cart"),
      node("paid"),
      node("shipped", { kind: "final" }),
      node("dropped", { kind: "final" }),
    ],
    edges: [
      edge("__initial__>>cart"),
      edge("cart>ADD>cart", { isStay: true }),
      edge("cart>PAY>paid"),
      edge("cart>DROP>dropped"),
      edge("paid>SHIP>shipped"),
    ],
  };
}

/** `paid` handles RESET and stays, so the any-state RESET still moves it back to `cart`. */
function createCheckout() {
  const cart = state("cart")();
  const paid = state("paid")();
  const shipped = state("shipped")().final();
  const dropped = state("dropped")().final();
  const drop = event("DROP")();
  const pay = event("PAY")();
  const reset = event("RESET")();
  const ship = event("SHIP")();
  const actor = Actor({
    inputs: [drop, pay, reset, ship],
    outputs: [],
    internal: [],
    states: [cart, paid, shipped, dropped],
    initial: cart,
    setup: (machine) => {
      machine.on(cart, { event: drop, to: [dropped], handler: () => ({ state: dropped }) });
      machine.on(cart, { event: pay, to: [paid], handler: () => ({ state: paid }) });
      machine.on(paid, { event: reset, handler: () => ({}) });
      machine.on(paid, { event: ship, to: [shipped], handler: () => ({ state: shipped }) });
      machine.onAny({ event: reset, to: [cart], handler: () => ({ state: cart }) });
    },
  });
  return { actor, refs: [drop, pay, reset, ship] };
}

/** The state a fresh checkout is in after each event of the walk. */
function landedStates(events: string[]): string[] {
  const { actor, refs } = createCheckout();
  const landed: string[] = [];
  for (const sent of events) {
    const ref = refs.find((candidate) => candidate.type === sent);
    if (ref !== undefined) actor.send(ref.create());
    landed.push(actor.state.name);
  }
  return landed;
}

describe("sendableEdges", () => {
  test("keeps root edges with a known target and drops the rest", () => {
    const graph: ActorGraph = {
      nodes: [
        node("__initial__", { kind: "initial" }),
        node("cart"),
        node("paid"),
        node("*", { kind: "any" }),
      ],
      edges: [
        edge("__initial__>>cart"),
        edge("cart>PAY>paid"),
        edge("*>RESET>cart"),
        edge("cart>TIMEOUT>cart", { isInternal: true }),
        edge("cart>GUESS>cart", { isUndetermined: true }),
        edge("cart>effect:cart>cart", { isInternal: true, effects: [] }),
        edge("form.editing>SAVE>form.saved"),
      ],
    };

    expect(sendableEdges(graph).map((kept) => kept.id)).toEqual(["cart>PAY>paid", "*>RESET>cart"]);
  });
});

describe("coveringWalks", () => {
  test("starts a new walk from the initial state when a final state ends one", () => {
    expect(coveringWalks(checkoutGraph())).toEqual({
      walks: [
        [
          { edgeId: "cart>ADD>cart", from: "cart", event: "ADD", to: "cart", sender: "outside" },
          { edgeId: "cart>PAY>paid", from: "cart", event: "PAY", to: "paid", sender: "outside" },
          {
            edgeId: "paid>SHIP>shipped",
            from: "paid",
            event: "SHIP",
            to: "shipped",
            sender: "outside",
          },
        ],
        [
          {
            edgeId: "cart>DROP>dropped",
            from: "cart",
            event: "DROP",
            to: "dropped",
            sender: "outside",
          },
        ],
      ],
      unreachable: [],
    });
  });

  test("plans the states a real actor lands in, with a stay handler under an any-state one", () => {
    const plan = coveringWalks(buildGraph(createCheckout().actor));
    const events = plan.walks.map((walk) => walk.map((step) => step.event));

    expect({ events, landed: events.map(landedStates), unreachable: plan.unreachable }).toEqual({
      events: [["DROP"], ["PAY", "RESET", "RESET", "PAY", "SHIP"]],
      landed: plan.walks.map((walk) => walk.map((step) => step.to)),
      unreachable: [],
    });
  });

  test("follows an event the machine raises itself to the edges behind it", () => {
    const graph: ActorGraph = {
      nodes: [
        node("__initial__", { kind: "initial" }),
        node("cart"),
        node("loading"),
        node("ready"),
        node("paid"),
      ],
      edges: [
        edge("__initial__>>cart"),
        edge("cart>CHECKOUT>loading"),
        edge("loading>LOADED>ready", { isInternal: true }),
        edge("ready>PAY>paid"),
      ],
    };

    expect(coveringWalks(graph)).toEqual({
      walks: [
        [
          {
            edgeId: "cart>CHECKOUT>loading",
            from: "cart",
            event: "CHECKOUT",
            to: "loading",
            sender: "outside",
          },
          {
            edgeId: "loading>LOADED>ready",
            from: "loading",
            event: "LOADED",
            to: "ready",
            sender: "machine",
          },
          { edgeId: "ready>PAY>paid", from: "ready", event: "PAY", to: "paid", sender: "outside" },
        ],
      ],
      unreachable: [],
    });
  });

  test("lists the edges whose source no walk can reach", () => {
    const graph: ActorGraph = {
      nodes: [
        node("__initial__", { kind: "initial" }),
        node("cart"),
        node("paid"),
        node("refunded"),
      ],
      edges: [edge("__initial__>>cart"), edge("cart>PAY>paid"), edge("refunded>CLOSE>cart")],
    };

    expect(coveringWalks(graph)).toEqual({
      walks: [
        [{ edgeId: "cart>PAY>paid", from: "cart", event: "PAY", to: "paid", sender: "outside" }],
      ],
      unreachable: ["refunded>CLOSE>cart"],
    });
  });

  test("plans no walk for a graph without an initial state", () => {
    const graph: ActorGraph = {
      nodes: [node("cart"), node("paid")],
      edges: [edge("cart>PAY>paid")],
    };

    expect(coveringWalks(graph)).toEqual({ walks: [], unreachable: ["cart>PAY>paid"] });
  });
});
