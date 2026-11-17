import { VIZ_SCHEMA_VERSION } from "../schema.ts";
import type { VizEdge, VizFuzzMessage, VizMachine, VizState } from "../schema.ts";
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
  messages?: VizFuzzMessage[];
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
    outputs: [],
    partOutputs: {},
    context: null,
    fuzz: parts.messages === undefined ? null : { messages: parts.messages },
    runs: [],
  } as unknown as VizMachine;
}

const renamed = machineOf({
  states: ["browsing", "waitingForPayment", "paid", "gaveUp", "payment.ready", "payment.charging"],
  edges: [
    edge("browsing", "PAY_CLICKED", "waitingForPayment", ["PAYMENT_STARTED"]),
    edge("waitingForPayment", "PAYMENT_CONFIRMED", "paid", ["ORDER_CLOSED"]),
    edge("waitingForPayment", "WAITED_TOO_LONG", "gaveUp", ["PAYMENT_TIMED_OUT"]),
    edge("payment.ready", "START", "payment.charging"),
    edge("payment.charging", "CARD_CHARGED", "payment.ready", ["PAYMENT_CONFIRMED"]),
    edge("payment.charging", "PAYMENT_TIMED_OUT", "payment.ready"),
    edge("payment.*", "ORDER_CLOSED", null),
  ],
  actors: ["payment"],
  messages: [
    { from: "paid", event: "ORDER_CLOSED", to: "payment.*" },
    { from: "payment.ready", event: "PAYMENT_CONFIRMED", to: "waitingForPayment" },
    { from: "waitingForPayment", event: "START", to: "payment.ready" },
  ],
});

describe("messagesOf", () => {
  test("a board that was not fuzzed has no lines", () => {
    expect(messagesOf({ ...renamed, fuzz: null })).toEqual([]);
  });

  test("an event name another machine's arrow takes draws no line unless fuzzing saw the send", () => {
    expect(messagesOf({ ...renamed, fuzz: { messages: [] } } as unknown as VizMachine)).toEqual([]);
  });

  test("a renamed wire, an any-state handler and a reply each keep their line, in document order", () => {
    expect(messagesOf(renamed)).toEqual(renamed.fuzz?.messages);
  });

  test("one line per pair of states, though several states of the receiver took it", () => {
    const kitchen = machineOf({
      states: ["takingOrders"],
      edges: [],
      messages: [
        { from: "takingOrders", event: "ITEM_ARRIVED", to: "orders.allWorkersFree" },
        { from: "takingOrders", event: "ITEM_ARRIVED", to: "orders.workersBusy" },
        { from: "takingOrders", event: "ITEM_ARRIVED", to: "orders.workWaiting" },
      ],
    });
    expect(messagesOf(kitchen)).toEqual([
      { from: "takingOrders", event: "ITEM_ARRIVED", to: "orders.allWorkersFree" },
    ]);
  });

  test("two events from one state to one state are one line, the first", () => {
    const twice = machineOf({
      states: ["paid"],
      edges: [],
      messages: [
        { from: "paid", event: "ONE", to: "stock.holding" },
        { from: "paid", event: "TWO", to: "stock.holding" },
      ],
    });
    expect(messagesOf(twice)).toEqual([{ from: "paid", event: "ONE", to: "stock.holding" }]);
  });

  test("the same message into two different states of the receiver is one line", () => {
    const two = machineOf({
      states: ["paid"],
      edges: [],
      messages: [
        { from: "paid", event: "ONE", to: "stock.holding" },
        { from: "paid", event: "ONE", to: "stock.free" },
      ],
    });
    expect(messagesOf(two)).toEqual([{ from: "paid", event: "ONE", to: "stock.holding" }]);
  });

  test("the same event from two states into one machine keeps both lines", () => {
    const both = machineOf({
      states: ["a", "b"],
      edges: [],
      messages: [
        { from: "a", event: "ONE", to: "stock.holding" },
        { from: "b", event: "ONE", to: "stock.holding" },
      ],
    });
    expect(messagesOf(both)).toHaveLength(2);
  });
});

describe("placeMachine with messages", () => {
  test("lines are placed apart from arrows, inside the canvas", () => {
    const placed = placeMachine(renamed);
    expect(placed.messages.map((message) => [message.from, message.to])).toEqual([
      ["paid", "payment.*"],
      ["payment.ready", "waitingForPayment"],
      ["waitingForPayment", "payment.ready"],
    ]);
    expect(placed.edges.filter((each) => each.edge.id.startsWith("message:"))).toEqual([]);
    for (const message of placed.messages) {
      for (const point of message.points) {
        expect(point.y).toBeGreaterThanOrEqual(LABEL_PAD);
        expect(point.y).toBeLessThanOrEqual(placed.height - LABEL_PAD);
        expect(point.x).toBeGreaterThanOrEqual(LABEL_PAD);
        expect(point.x).toBeLessThanOrEqual(placed.width - LABEL_PAD);
      }
    }
    expect(overlapsOf(placed)).toEqual([]);
  });

  test("a board without messages has none", () => {
    expect(placeMachine({ ...renamed, fuzz: null }).messages).toEqual([]);
  });
});
