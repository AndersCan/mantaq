import { describe, expect, test } from "vite-plus/test";
import type { VizEdge, VizLiveStep, VizMachine } from "../schema.ts";
import { blockedReason, examplePayload } from "./blocked.ts";

function pay(over: Partial<VizEdge> = {}): VizEdge {
  return {
    id: "cart-pay-payment",
    from: "cart",
    event: "pay",
    to: "payment",
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: {
      status: "analyzed",
      location: { file: "order.ts", line: 1, column: 1 },
      registration: "on",
      branches: [],
      payloadReads: ["email"],
      contextReads: ["items"],
      contextWrites: [],
      readsActorState: false,
      comparisons: [
        { source: "payload", path: "email", operator: "!==", literal: "" },
        { source: "context", path: "items", operator: "!==", literal: 0 },
      ],
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
    ...over,
  };
}

function outcome(kind: VizLiveStep["outcome"], error: string | null = null): VizLiveStep {
  return {
    from: "cart",
    event: "pay",
    to: "cart",
    outcome: kind,
    effects: [],
    sent: [],
    context: null,
    error,
  };
}

const payloadOnly = (): VizEdge => {
  const base = pay();
  if (base.explanation?.status !== "analyzed") throw new Error("fixture");
  return {
    ...base,
    explanation: {
      ...base.explanation,
      contextReads: [],
      comparisons: [base.explanation.comparisons[0]!],
    },
  };
};

describe("blockedReason", () => {
  test("a stay with items 0 names the context value", () => {
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: { items: 0 } })).toBe(
      "pay is blocked: items is 0",
    );
  });

  test("a value that is not in the context reads not set", () => {
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: {} })).toBe(
      "pay is blocked: items is not set",
    );
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: null })).toBe(
      "pay is blocked: items is not set",
    );
  });

  test("a dotted path walks into nested context", () => {
    const edge = pay();
    if (edge.explanation?.status !== "analyzed") throw new Error("fixture");
    const nested = {
      ...edge,
      explanation: {
        ...edge.explanation,
        comparisons: [
          { source: "context" as const, path: "cart.items", operator: "===" as const, literal: 1 },
        ],
      },
    };
    expect(
      blockedReason({ edge: nested, outcome: outcome("stay"), live: { cart: { items: 2 } } }),
    ).toBe("pay is blocked: cart.items is 2");
    expect(blockedReason({ edge: nested, outcome: outcome("stay"), live: { cart: [] } })).toBe(
      "pay is blocked: cart.items is not set",
    );
  });

  test("a transition, an ignored event and a missing actor are not blocked", () => {
    for (const kind of ["transition", "ignored", "missing"] as const) {
      expect(blockedReason({ edge: pay(), outcome: outcome(kind), live: { items: 0 } })).toBeNull();
    }
  });

  test("a handler that threw is blocked", () => {
    expect(
      blockedReason({ edge: pay(), outcome: outcome("missing", "boom"), live: { items: 0 } }),
    ).toBe("pay is blocked: items is 0");
  });

  test("no outcome, a stay edge, or an unanalyzed edge is not blocked", () => {
    const live = { items: 0 };
    expect(blockedReason({ edge: pay(), outcome: null, live })).toBeNull();
    expect(
      blockedReason({ edge: pay({ kind: "stay" }), outcome: outcome("stay"), live }),
    ).toBeNull();
    expect(
      blockedReason({ edge: pay({ explanation: null }), outcome: outcome("stay"), live }),
    ).toBeNull();
  });

  test("a payload-only guard is not blocked", () => {
    expect(
      blockedReason({ edge: payloadOnly(), outcome: outcome("stay"), live: { items: 0 } }),
    ).toBeNull();
  });

  test("without comparisons the context reads name the cause", () => {
    const edge = pay();
    if (edge.explanation?.status !== "analyzed") throw new Error("fixture");
    const reads = { ...edge, explanation: { ...edge.explanation, comparisons: [] } };
    expect(blockedReason({ edge: reads, outcome: outcome("stay"), live: { items: 0 } })).toBe(
      "pay is blocked: items is 0",
    );
  });
});

describe("examplePayload", () => {
  const machine = {
    events: [
      {
        id: "pay",
        internal: false,
        doc: null,
        payload: [
          {
            name: "email",
            type: "string",
            optional: false,
            doc: null,
            input: "text",
            choices: [],
            sample: "ana@example.com",
          },
        ],
      },
      { id: "addItem", internal: false, doc: null, payload: null },
    ],
    fuzz: {
      corpus: [{ steps: [{ kind: "event", event: "pay", payload: { email: "" } }] }],
      errors: [],
    },
  } as unknown as VizMachine;

  test("uses the field example, not an earlier sent value", () => {
    expect(examplePayload(machine, "pay")).toEqual({ email: "ana@example.com" });
  });

  test("an event with no data sends null", () => {
    expect(examplePayload(machine, "addItem")).toBeNull();
  });
});
