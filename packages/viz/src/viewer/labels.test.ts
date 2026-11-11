import type { VizBranch, VizEdge } from "../schema.ts";
import { edgeCondition, edgeLines } from "./labels.ts";
import { describe, expect, test } from "vite-plus/test";

function branch(conditions: string[], state: string | null): VizBranch {
  return { conditions, target: state === null ? { kind: "stay" } : { kind: "state", state } };
}

function edgeWith(
  branches: VizBranch[],
  over: { readsActorState?: boolean; to?: string | null; kind?: VizEdge["kind"] } = {},
): VizEdge {
  return {
    id: "cart-pay-payment",
    from: "cart",
    event: "pay",
    to: over.to === undefined ? "payment" : over.to,
    kind: over.kind ?? "transition",
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
      readsActorState: over.readsActorState ?? false,
      comparisons: [],
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
  } as unknown as VizEdge;
}

const order6 = [
  branch(['event.payload.email === ""'], null),
  branch(['!(event.payload.email === "")', "context.get().items === 0"], null),
  branch(['!(event.payload.email === "")', "!(context.get().items === 0)"], "payment"),
];

describe("edgeCondition", () => {
  test("the going branch of the order guard reads as one line", () => {
    expect(edgeCondition(edgeWith(order6))).toBe('email !== "" && items !== 0');
  });

  test("two going branches are joined with ||", () => {
    const edge = edgeWith([
      branch(["a > 1"], "payment"),
      branch(["!(a > 1)", "b"], "payment"),
      branch(["c"], null),
    ]);
    expect(edgeCondition(edge)).toBe("a > 1 || a <= 1 && b");
  });

  test("a negation of more than one comparison is kept", () => {
    const edge = edgeWith([branch(["!(a === 1 && b)"], "payment"), branch(["x"], null)]);
    expect(edgeCondition(edge)).toBe("!(a === 1 && b)");
  });

  test("null when every branch goes", () => {
    expect(
      edgeCondition(edgeWith([branch(["a"], "payment"), branch(["!(a)"], "payment")])),
    ).toBeNull();
  });

  test("null when no branch reaches the target", () => {
    expect(edgeCondition(edgeWith([branch(["a"], null)]))).toBeNull();
  });

  test("null when a going branch has no condition", () => {
    expect(edgeCondition(edgeWith([branch([], "payment"), branch(["a"], null)]))).toBeNull();
  });

  test("null when the handler reads actor state", () => {
    expect(edgeCondition(edgeWith(order6, { readsActorState: true }))).toBeNull();
  });

  test("null when the target is undetermined", () => {
    expect(edgeCondition(edgeWith(order6, { to: null }))).toBeNull();
  });

  test("null for a stay edge", () => {
    expect(edgeCondition(edgeWith(order6, { kind: "stay" }))).toBeNull();
  });

  test("null when the explanation is not analyzed", () => {
    const edge = {
      ...edgeWith(order6),
      explanation: { status: "not_analyzed", location: null, reason: "x", snippet: null },
    } as VizEdge;
    expect(edgeCondition(edge)).toBeNull();
  });
});

describe("edgeLines", () => {
  test("event then condition", () => {
    expect(edgeLines(edgeWith(order6))).toEqual(["pay", 'email !== "" && items !== 0']);
  });

  test("a long condition is cut to 32 characters", () => {
    const long = "someLongName === 1 && anotherLongName === 2";
    const [, line] = edgeLines(edgeWith([branch([long], "payment"), branch(["x"], null)]));
    expect(line).toBe(`${long.slice(0, 31)}…`);
  });

  test("an unconditional edge is the event alone", () => {
    expect(edgeLines(edgeWith([branch(["a"], "payment")]))).toEqual(["pay"]);
  });
});
