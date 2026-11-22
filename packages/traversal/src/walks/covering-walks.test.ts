import type { ActorGraph, GraphEdge, GraphNode } from "../types.ts";
import { coveringWalks, sendableEdges } from "./covering-walks.ts";
import { describe, expect, test } from "vite-plus/test";

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
          { edgeId: "cart>ADD>cart", from: "cart", event: "ADD", to: "cart" },
          { edgeId: "cart>PAY>paid", from: "cart", event: "PAY", to: "paid" },
          { edgeId: "paid>SHIP>shipped", from: "paid", event: "SHIP", to: "shipped" },
        ],
        [{ edgeId: "cart>DROP>dropped", from: "cart", event: "DROP", to: "dropped" }],
      ],
      unreachable: [],
    });
  });

  test("takes an any-state edge from a state with no handler of its own for the event", () => {
    const graph: ActorGraph = {
      nodes: [
        node("__initial__", { kind: "initial" }),
        node("cart"),
        node("paid"),
        node("*", { kind: "any" }),
      ],
      edges: [
        edge("__initial__>>cart"),
        edge("cart>RESET>cart", { isStay: true }),
        edge("cart>PAY>paid"),
        edge("*>RESET>cart"),
        edge("*>PING>*", { isStay: true }),
      ],
    };

    expect(coveringWalks(graph)).toEqual({
      walks: [
        [
          { edgeId: "cart>RESET>cart", from: "cart", event: "RESET", to: "cart" },
          { edgeId: "cart>PAY>paid", from: "cart", event: "PAY", to: "paid" },
          { edgeId: "*>RESET>cart", from: "paid", event: "RESET", to: "cart" },
          { edgeId: "*>PING>*", from: "cart", event: "PING", to: "cart" },
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
      walks: [[{ edgeId: "cart>PAY>paid", from: "cart", event: "PAY", to: "paid" }]],
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
