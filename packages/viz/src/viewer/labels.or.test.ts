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

describe("edgeCondition || and unresolved", () => {
  // if (event.payload.email === "") return {};
  // if (context.get().vip || context.get().items > 3) return { state: payment };
  // return {};
  test("a condition with || keeps its meaning when joined with &&", () => {
    const edge = edgeWith([
      { conditions: ['event.payload.email === ""'], target: { kind: "stay" } },
      {
        conditions: [
          '!(event.payload.email === "")',
          "context.get().vip || context.get().items > 3",
        ],
        target: { kind: "state", state: "payment" },
      },
      {
        conditions: [
          '!(event.payload.email === "")',
          "!(context.get().vip || context.get().items > 3)",
        ],
        target: { kind: "stay" },
      },
    ]);
    expect(edgeCondition(edge)).toBe('email !== "" && (vip || items > 3)');
  });

  // return ok ? { state: payment } : next();  (plan: an unresolved branch gives no condition line)
  test("an unresolved branch gives no condition", () => {
    const edge = edgeWith([
      { conditions: ["ok"], target: { kind: "state", state: "payment" } },
      { conditions: ["!(ok)"], target: { kind: "unresolved", text: "next()" } },
    ]);
    expect(edgeCondition(edge)).toBeNull();
  });
});
