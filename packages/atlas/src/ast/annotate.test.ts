import { toAtlasMachine } from "../atlas.ts";
import { EXAMPLE_ROOT, exampleTargets } from "../examples.ts";
import { createCheckoutActor } from "../fixtures/checkout.ts";
import { createCreditActor } from "../fixtures/credit.ts";
import { createSagaActor } from "../fixtures/saga.ts";
import { createStateRoutingActor } from "../fixtures/state-routing.ts";
import type { AtlasExplanation, AtlasMachine } from "../schema.ts";
import { analyzeSource, annotateMachine } from "./annotate.ts";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const FIXTURES = join(EXAMPLE_ROOT, "packages/atlas/src/fixtures");

function annotated(id: string, actor: Parameters<typeof toAtlasMachine>[0]["actor"]): AtlasMachine {
  return annotateMachine(toAtlasMachine({ id, actor }), {
    file: join(FIXTURES, `${id}.ts`),
    root: EXAMPLE_ROOT,
  });
}

function analyzed(explanation: AtlasExplanation | null | undefined) {
  return explanation?.status === "analyzed" ? explanation : undefined;
}

describe("AST: conditional handler (credit)", () => {
  const machine = annotated("credit", createCreditActor());
  const apply = machine.edges.find((edge) => edge.event === "apply");

  test("the graph has every declared branch; the AST explains all three", () => {
    const targets = machine.edges.filter((edge) => edge.event === "apply").map((edge) => edge.to);
    expect(targets).toEqual(["approved", "manualReview", "rejected"]);
    const explanation = analyzed(apply?.explanation);
    expect(explanation?.branches).toEqual([
      { conditions: ["score < 600"], target: { kind: "state", state: "rejected" } },
      {
        conditions: ["!(score < 600)", 'amount > 50000 && context.get().tier !== "gold"'],
        target: { kind: "state", state: "manualReview" },
      },
      {
        conditions: ["!(score < 600)", '!(amount > 50000 && context.get().tier !== "gold")'],
        target: { kind: "state", state: "approved" },
      },
    ]);
  });

  test("reads, comparisons, literals and location", () => {
    const explanation = analyzed(apply?.explanation);
    expect(explanation?.location).toEqual({
      file: "packages/atlas/src/fixtures/credit.ts",
      line: expect.any(Number),
      column: 7,
    });
    expect(explanation?.registration).toBe("on");
    expect(explanation?.payloadReads).toEqual(["amount", "score"]);
    expect(explanation?.contextReads).toEqual(["tier"]);
    expect(explanation?.comparisons).toEqual([
      { source: "payload", path: "score", operator: "<", literal: 600 },
      { source: "payload", path: "amount", operator: ">", literal: 50000 },
      { source: "context", path: "tier", operator: "!==", literal: "gold" },
    ]);
    expect(explanation?.literals).toEqual([50000, 600, "gold"]);
  });

  test("ternary inside `state:` splits into two branches", () => {
    const decide = machine.edges.find((edge) => edge.event === "decide");
    expect(analyzed(decide?.explanation)?.branches.map((branch) => branch.target)).toEqual([
      { kind: "state", state: "approved" },
      { kind: "state", state: "rejected" },
    ]);
  });

  test("context write with no state change is a stay branch", () => {
    const setTier = machine.edges.find((edge) => edge.event === "setTier");
    const explanation = analyzed(setTier?.explanation);
    expect(explanation?.branches).toEqual([{ conditions: [], target: { kind: "stay" } }]);
    expect(explanation?.contextWrites).toEqual(["tier"]);
    expect(explanation?.payloadReads).toEqual(["tier"]);
  });

  test("handler passed by reference is not analyzed, with a snippet", () => {
    const reset = machine.edges.find((edge) => edge.event === "reset");
    expect(reset?.explanation).toEqual({
      status: "not_analyzed",
      location: expect.objectContaining({ file: "packages/atlas/src/fixtures/credit.ts" }),
      reason: "handler `resetHandler` is a reference, not an inline function",
      snippet: "resetHandler",
    });
  });
});

describe("AST: examples", () => {
  test("onAny handler reading live actor state is flagged, explained on the any-state edges", () => {
    const machine = annotated("state-routing", createStateRoutingActor());
    const back = machine.edges.filter((edge) => edge.event === "back");
    expect(back.map((edge) => edge.from)).toEqual(["*", "*"]);
    for (const edge of back) {
      const explanation = analyzed(edge.explanation);
      expect(explanation?.registration).toBe("onAny");
      expect(explanation?.readsActorState).toBe(true);
    }
    const targets = analyzed(back[0]?.explanation)?.branches.map((branch) => branch.target);
    expect(targets).toEqual([
      { kind: "state", state: "second" },
      { kind: "state", state: "first" },
      { kind: "stay" },
    ]);
  });

  test("checkout back: per-state handlers read no actor state", () => {
    const machine = annotated("checkout", createCheckoutActor());
    const back = machine.edges.filter((edge) => edge.event === "back");
    expect(back.length).toBe(3);
    for (const edge of back) {
      expect(analyzed(edge.explanation)?.registration).toBe("on");
      expect(analyzed(edge.explanation)?.readsActorState).toBe(false);
    }
  });

  test("saga: specific `on` wins over onAny; payload paths are dotted", () => {
    const machine = annotated("saga", createSagaActor());
    const reserved = machine.edges.find((edge) => edge.event === "INVENTORY_RESERVED");
    expect(analyzed(reserved?.explanation)?.payloadReads).toEqual(["result.reservationId"]);
    expect(analyzed(reserved?.explanation)?.registration).toBe("on");
    const cancel = machine.edges.find((edge) => edge.event === "CANCEL");
    expect(analyzed(cancel?.explanation)?.contextReads).toEqual(["completedSteps"]);
  });

  test("effect and initial edges carry no explanation; every handler edge has one", () => {
    for (const example of exampleTargets()) {
      const machine = annotateMachine(
        toAtlasMachine({ id: example.id, actor: example.create().actor }),
        { file: example.source, root: EXAMPLE_ROOT },
      );
      for (const edge of machine.edges) {
        const handlerDriven = edge.kind === "transition" || edge.kind === "stay";
        expect(edge.explanation === null).toBe(!handlerDriven);
      }
    }
    // One TypeScript program per example: ~6s on CI runners, past the 5s default.
  }, 30_000);

  test("deterministic: same source => identical sites", () => {
    const file = join(FIXTURES, "credit.ts");
    expect(analyzeSource({ file, root: EXAMPLE_ROOT })).toEqual(
      analyzeSource({ file, root: EXAMPLE_ROOT }),
    );
    expect(Either.isRight(analyzeSource({ file, root: EXAMPLE_ROOT }))).toBe(true);
  });
});
