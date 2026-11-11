import type { VizBranch, VizEdge } from "../schema.ts";
import { edgeCondition } from "./labels.ts";
import { describe, expect, test } from "vite-plus/test";

function edgeWith(branches: VizBranch[]): VizEdge {
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
      location: { file: "a.ts", line: 1, column: 1 },
      registration: "on",
      branches,
      payloadReads: [],
      contextReads: [],
      contextWrites: [],
      readsActorState: false,
      comparisons: [],
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
  } as unknown as VizEdge;
}

describe("edgeCondition one condition per branch", () => {
  // if (event.payload.email === "") return {}; return { state: payment };
  test("a lone condition is tidied", () => {
    const edge = edgeWith([
      { conditions: ['event.payload.email === ""'], target: { kind: "stay" } },
      {
        conditions: ['!(event.payload.email === "")'],
        target: { kind: "state", state: "payment" },
      },
    ]);
    expect(edgeCondition(edge)).toBe('email !== ""');
  });

  // if (context.get().vip || context.get().items > 3) return { state: payment }; return {};
  test("a lone || condition gets no parentheses", () => {
    const edge = edgeWith([
      {
        conditions: ["context.get().vip || context.get().items > 3"],
        target: { kind: "state", state: "payment" },
      },
      {
        conditions: ["!(context.get().vip || context.get().items > 3)"],
        target: { kind: "stay" },
      },
    ]);
    expect(edgeCondition(edge)).toBe("vip || items > 3");
  });
});
