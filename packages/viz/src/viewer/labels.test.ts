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

  test("a double negation of a name reads as the name", () => {
    const edge = edgeWith([
      branch(["!(!hasFood)", "!(!hasPlate)"], "payment"),
      branch(["x"], null),
    ]);
    expect(edgeCondition(edge)).toBe("hasFood && hasPlate");
  });

  test("a negated single name, property or call loses its brackets", () => {
    const text = (guard: string): string | null =>
      edgeCondition(edgeWith([branch([guard], "payment"), branch(["x"], null)]));
    expect(text("!(noFood)")).toBe("!noFood");
    expect(text("!(order.paid)")).toBe("!order.paid");
    expect(text("!(isPaid(order))")).toBe("!isPaid(order)");
  });

  test("a negated name inside a longer condition is kept", () => {
    const text = (guard: string): string | null =>
      edgeCondition(edgeWith([branch([guard], "payment"), branch(["x"], null)]));
    expect(text("!(!a && b)")).toBe("!(!a && b)");
    expect(text("!(a && b)")).toBe("!(a && b)");
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

  test("a handler that reads actor state still gets its text", () => {
    const edge = edgeWith(
      [
        branch(['actor.state.name === "third"'], "second"),
        branch(['!(actor.state.name === "third")', 'actor.state.name === "second"'], "first"),
      ],
      { readsActorState: true, to: "first" },
    );
    expect(edgeCondition(edge)).toBe('else if actor.state.name === "second"');
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

  test("a long condition is one whole line", () => {
    const long = 'current.completedSteps.includes("inventory")';
    const [, line] = edgeLines(edgeWith([branch([long], "payment"), branch(["x"], null)]));
    expect(line).toBe(long);
  });

  test("a split edge is two lines, never more", () => {
    const [, line] = edgeLines(edgeWith(apply, { to: "manualReview" }));
    expect(line).toBe('else if amount > 50000 && tier !== "gold"');
  });

  test("an unconditional edge is the event alone", () => {
    expect(edgeLines(edgeWith([branch(["a"], "payment")]))).toEqual(["pay"]);
  });

  test("a label is never more than two lines (layout leaves room for two)", () => {
    const many = [branch(["a"], "x"), branch(["b"], "y"), branch(["c"], "z"), branch(["d"], null)];
    expect(edgeLines(edgeWith(many)).length).toBeLessThanOrEqual(2);
    expect(edgeLines(edgeWith(order6)).length).toBeLessThanOrEqual(2);
  });
});

const apply = [
  branch(["event.payload.score < 600"], "rejected"),
  branch(
    [
      "!(event.payload.score < 600)",
      'event.payload.amount > 50000 && context.get().tier !== "gold"',
    ],
    "manualReview",
  ),
  branch(
    [
      "!(event.payload.score < 600)",
      '!(event.payload.amount > 50000 && context.get().tier !== "gold")',
    ],
    "approved",
  ),
];

function textsOf(branches: VizBranch[], tos: string[]): Array<string | null> {
  return tos.map((to) => edgeCondition(edgeWith(branches, { to })));
}

describe("edgeCondition when one event leads to several states", () => {
  test("two ways: the condition, then else", () => {
    const answered = [
      branch(['event.payload.answer === "accepted"'], "accepted"),
      branch(['!(event.payload.answer === "accepted")'], "declined"),
    ];
    expect(textsOf(answered, ["accepted", "declined"])).toEqual(['answer === "accepted"', "else"]);
  });

  test("three ways: condition, else if, else", () => {
    expect(textsOf(apply, ["rejected", "manualReview", "approved"])).toEqual([
      "score < 600",
      'else if amount > 50000 && tier !== "gold"',
      "else",
    ]);
  });

  test("a guard shared by every arm is left off", () => {
    const shared = [
      branch(["a"], "x"),
      branch(["!(a)", "b"], "y"),
      branch(["!(a)", "!(b)", "c"], null),
    ];
    expect(textsOf(shared, ["x", "y"])).toEqual(["a", "else if b"]);
    const both = [branch(["g", "a"], "x"), branch(["g", "!(a)"], "y"), branch(["!(g)"], null)];
    expect(textsOf(both, ["x", "y"])).toEqual(["a", "else"]);
  });

  test("a ternary reads as the condition and else", () => {
    const review = [
      branch(["(e.payload?.amount ?? 0) > 100"], "rejected"),
      branch(["!((e.payload?.amount ?? 0) > 100)"], "approved"),
    ];
    expect(textsOf(review, ["rejected", "approved"])).toEqual([
      "(e.payload?.amount ?? 0) > 100",
      "else",
    ]);
  });

  test("an arm with no condition of its own and no else side has no text", () => {
    expect(edgeCondition(edgeWith([branch([], "payment"), branch([], "other")]))).toBeNull();
  });
});

describe("edgeCondition else side needs the same earlier conditions", () => {
  test("an arm ruled out only under another outer branch is not else", () => {
    // if (a) return c ? x : y; if (c) return; return w;
    const nested = [
      branch(["a", "c"], "x"),
      branch(["a", "!(c)"], "y"),
      branch(["!(a)", "c"], null),
      branch(["!(a)", "!(c)"], "w"),
    ];
    expect(textsOf(nested, ["x", "y", "w"])).toEqual(["a && c", "else if a", "else if !c"]);
  });
});

describe("edgeCondition when one arrow is reached twice around another", () => {
  test("if (a) return x; if (b) return y; return x; keeps x's text true", () => {
    const twice = [branch(["a"], "x"), branch(["!(a)", "b"], "y"), branch(["!(a)", "!(b)"], "x")];
    expect(textsOf(twice, ["x", "y"])).toEqual(["a || !a && !b", "else if b"]);
  });
});
