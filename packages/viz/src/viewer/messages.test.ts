import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { sentByParts } from "./blocked.ts";
import { LABEL_PAD } from "./geometry.ts";
import { messagesOf, placeMachine } from "./layout.ts";
import { overlapsOf } from "./overlaps.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string): VizState {
  const dot = id.indexOf(".");
  return {
    id,
    label: id,
    region: dot < 0 ? null : id.slice(0, dot),
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(from: string, event: string, to: string | null, emits: string[] = []): VizEdge {
  return {
    id: `${from}-${event}-${to ?? "stay"}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits,
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function machineOf(parts: {
  states: string[];
  edges: VizEdge[];
  actors?: string[];
  maps?: string[];
  outputs?: string[];
  partOutputs?: Record<string, string[]>;
}): VizMachine {
  const regions = [
    ...new Set(parts.states.flatMap((id) => (id.includes(".") ? [id.split(".")[0] ?? ""] : []))),
  ];
  return {
    version: VIZ_SCHEMA_VERSION,
    id: "m",
    initial: parts.states[0] ?? null,
    states: parts.states.map(state),
    edges: parts.edges,
    events: [],
    regions,
    maps: parts.maps ?? [],
    actors: parts.actors ?? [],
    outputs: parts.outputs ?? [],
    partOutputs: parts.partOutputs ?? {},
    context: null,
    fuzz: null,
    runs: [],
  } as unknown as VizMachine;
}

const lost = machineOf({
  states: ["browsing", "waitingForPayment", "gaveUp", "payment.ready", "payment.charging"],
  edges: [
    edge("browsing", "PAY_CLICKED", "waitingForPayment", ["PAYMENT_STARTED"]),
    edge("waitingForPayment", "WAITED_TOO_LONG", "gaveUp", ["PAYMENT_TIMED_OUT"]),
    edge("payment.ready", "PAYMENT_STARTED", "payment.charging"),
    edge("payment.charging", "PAYMENT_TIMED_OUT", "payment.ready"),
  ],
  actors: ["payment"],
  outputs: ["PAYMENT_STARTED", "PAYMENT_TIMED_OUT"],
});

const kitchen = machineOf({
  states: ["open", "waiter.serving", "waiter.carryingDish"],
  edges: [
    edge("open", "DISH_COOKED", "open", ["DISH_READY"]),
    edge("waiter.serving", "DISH_READY", "waiter.carryingDish"),
  ],
  actors: ["waiter"],
  outputs: ["DISH_READY"],
});

const stock = machineOf({
  states: ["waitingForStock", "waitingForPayment", "stock.free", "stock.holding"],
  edges: [
    edge("stock.free", "HOLD_ITEM", "stock.holding", ["ITEM_HELD"]),
    edge("waitingForStock", "ITEM_HELD", "waitingForPayment"),
  ],
  actors: ["stock"],
  partOutputs: { stock: ["ITEM_HELD"] },
});

describe("messagesOf", () => {
  test("a message runs from the state the sender is in to the arrow that takes it", () => {
    expect(messagesOf(lost)).toEqual([
      { from: "waitingForPayment", to: "payment.ready", event: "PAYMENT_STARTED" },
      { from: "gaveUp", to: "payment.charging", event: "PAYMENT_TIMED_OUT" },
    ]);
  });

  test("a stay edge sends from its own state", () => {
    expect(messagesOf(kitchen)).toEqual([
      { from: "open", to: "waiter.serving", event: "DISH_READY" },
    ]);
  });

  test("a part can send to the root", () => {
    expect(messagesOf(stock)).toEqual([
      { from: "stock.holding", to: "waitingForStock", event: "ITEM_HELD" },
    ]);
  });

  test("a region that is not an actor gets no line", () => {
    expect(messagesOf({ ...stock, actors: [] })).toEqual([]);
  });

  test("a map gets no line", () => {
    expect(messagesOf({ ...stock, actors: [], maps: ["stock"] })).toEqual([]);
  });

  test("an arrow from any state takes no message", () => {
    const anyState = {
      ...stock,
      edges: [stock.edges[0], edge("stock.*", "ITEM_HELD", "waitingForPayment")],
    };
    expect(messagesOf(anyState as VizMachine)).toEqual([]);
  });

  test("a sender that ends nowhere sends no line", () => {
    const sender = edge("stock.free", "HOLD_ITEM", null, ["ITEM_HELD"]);
    expect(messagesOf({ ...stock, edges: [sender, stock.edges[1]] } as VizMachine)).toEqual([]);
  });

  test("an event handled in the sender's own scope draws no line", () => {
    const own = machineOf({
      states: ["a", "b"],
      edges: [edge("a", "GO", "b", ["DONE"]), edge("b", "DONE", "a")],
    });
    expect(messagesOf(own)).toEqual([]);
  });

  test("two events between the same two states are one line", () => {
    const twice = machineOf({
      states: ["paid", "stock.holding", "stock.free"],
      edges: [
        edge("paid", "A", "paid", ["ONE", "TWO"]),
        edge("stock.holding", "ONE", "stock.free"),
        edge("stock.holding", "TWO", "stock.free"),
      ],
      actors: ["stock"],
    });
    expect(messagesOf(twice)).toEqual([{ from: "paid", to: "stock.holding", event: "ONE" }]);
  });

  test("one event taken in two states of the other machine is one line", () => {
    const two = machineOf({
      states: ["paid", "stock.holding", "stock.free"],
      edges: [
        edge("paid", "A", "paid", ["ONE"]),
        edge("stock.holding", "ONE", "stock.free"),
        edge("stock.free", "ONE", "stock.holding"),
      ],
      actors: ["stock"],
    });
    expect(messagesOf(two)).toEqual([{ from: "paid", to: "stock.holding", event: "ONE" }]);
  });

  test("every line implies the refusal of a by-hand click on the arrow that takes it", () => {
    for (const machine of [lost, kitchen, stock]) {
      for (const message of messagesOf(machine)) {
        for (const receiver of machine.edges.filter(
          (each) => each.from === message.to && each.event === message.event,
        )) {
          expect(sentByParts(machine, receiver).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("placeMachine with messages", () => {
  test.each([lost, kitchen])("lines are placed apart from arrows, inside the canvas", (machine) => {
    const placed = placeMachine(machine);
    expect(placed.messages.map((message) => [message.from, message.to])).toEqual(
      messagesOf(machine).map((message) => [message.from, message.to]),
    );
    expect(placed.edges.filter((each) => each.edge.id.startsWith("message:"))).toEqual([]);
    for (const message of placed.messages) {
      for (const point of message.points) {
        expect(point.y).toBeGreaterThanOrEqual(LABEL_PAD);
        expect(point.y).toBeLessThanOrEqual(placed.height - LABEL_PAD);
      }
    }
    expect(overlapsOf(placed)).toEqual([]);
  });

  test("a board without messages has none", () => {
    expect(placeMachine({ ...lost, actors: [] }).messages).toEqual([]);
  });
});
