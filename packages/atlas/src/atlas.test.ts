import { toAtlas } from "./atlas.ts";
import { exampleInputs } from "./examples.ts";
import { createAuthActor } from "./fixtures/auth.ts";
import { createCheckoutActor, submitBasicInfo } from "./fixtures/checkout.ts";
import { createSagaActor } from "./fixtures/saga.ts";
import { createConditionalActor } from "./fixtures/conditional.ts";
import { serializeAtlas } from "./serialize.ts";
import { instrument } from "@mantaq/traversal";
import { describe, expect, test } from "vite-plus/test";

describe("toAtlas structure", () => {
  test("checkout: states, initial and final flags", () => {
    const doc = toAtlas([{ id: "checkout", actor: createCheckoutActor() }]);
    const machine = doc.machines[0];
    expect(machine?.initial).toBe("basicInfo");
    expect(machine?.states.map((s) => s.id)).toEqual([
      "basicInfo",
      "error",
      "payment",
      "shippingAddress",
      "submitting",
      "success",
    ]);
    expect(machine?.states.find((s) => s.id === "success")?.final).toBe(true);
    expect(machine?.states.find((s) => s.id === "basicInfo")?.initial).toBe(true);
  });

  test("checkout: internal events flagged, effect edge present", () => {
    const machine = toAtlas([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    expect(machine?.events.find((e) => e.id === "paymentOk")?.internal).toBe(true);
    expect(machine?.events.find((e) => e.id === "back")?.internal).toBe(false);
    expect(machine?.edges.some((e) => e.kind === "effect" && e.from === "submitting")).toBe(true);
    expect(machine?.edges.find((e) => e.kind === "initial")?.to).toBe("basicInfo");
  });

  test("handler reading live actor state is undetermined (to: null)", () => {
    const machine = toAtlas([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    const back = machine?.edges.filter((e) => e.event === "back") ?? [];
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((e) => e.to === null)).toBe(true);
  });

  test("known limit: payload-dependent branch shows only the branch the synthetic event takes", () => {
    const machine = toAtlas([{ id: "cond", actor: createConditionalActor() }]).machines[0];
    const targets = machine?.edges.filter((e) => e.event === "review").map((e) => e.to);
    expect(targets).toEqual(["approved"]);
    expect(machine?.edges.find((e) => e.event === "review")?.explanation).toBeNull();
  });

  test("no history means null coverage and null payload types", () => {
    const machine = toAtlas([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    expect(machine?.states.every((s) => s.coverage === null)).toBe(true);
    expect(machine?.edges.every((e) => e.coverage === null)).toBe(true);
    expect(machine?.events.every((e) => e.payloadType === null)).toBe(true);
  });
});

describe("determinism", () => {
  test("same machine serializes to byte-identical JSON", () => {
    const first = serializeAtlas(toAtlas([{ id: "checkout", actor: createCheckoutActor() }]));
    const second = serializeAtlas(toAtlas([{ id: "checkout", actor: createCheckoutActor() }]));
    expect(first).toBe(second);
  });

  test("input order does not change output", () => {
    const a = { id: "a", actor: createCheckoutActor() };
    const b = { id: "b", actor: createConditionalActor() };
    expect(serializeAtlas(toAtlas([a, b]))).toBe(serializeAtlas(toAtlas([b, a])));
  });

  test("auth snapshot", () => {
    expect(serializeAtlas(toAtlas([{ id: "auth", actor: createAuthActor() }]))).toMatchSnapshot();
  });

  test("saga snapshot", () => {
    expect(serializeAtlas(toAtlas([{ id: "saga", actor: createSagaActor() }]))).toMatchSnapshot();
  });

  test("checkout snapshot", () => {
    expect(
      serializeAtlas(toAtlas([{ id: "checkout", actor: createCheckoutActor() }])),
    ).toMatchSnapshot();
  });
});

describe("coverage", () => {
  test("example export keeps back undetermined (structure from a fresh actor)", () => {
    const machine = toAtlas(exampleInputs()).machines.find((m) => m.id === "checkout");
    const back = machine?.edges.filter((e) => e.event === "back") ?? [];
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((e) => e.to === null)).toBe(true);
  });

  test("counts state visits and edge hits from instrumented run", () => {
    const run = instrument(createCheckoutActor());
    run.send(submitBasicInfo.create({ email: "a@b.c" }));
    const machine = toAtlas([
      { id: "checkout", actor: createCheckoutActor(), history: run.history },
    ]).machines[0];
    expect(machine?.states.find((s) => s.id === "shippingAddress")?.coverage).toEqual({ hits: 1 });
    expect(machine?.states.find((s) => s.id === "payment")?.coverage).toEqual({ hits: 0 });
    const edge = machine?.edges.find(
      (e) => e.from === "basicInfo" && e.event === "submitBasicInfo",
    );
    expect(edge?.coverage).toEqual({ hits: 1 });
  });
});
