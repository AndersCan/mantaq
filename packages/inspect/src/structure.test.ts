import { toViz } from "./structure.ts";
import { exampleInputs } from "./examples.ts";
import { createAuthActor } from "./fixtures/auth.ts";
import { createCheckoutActor, submitBasicInfo } from "./fixtures/checkout.ts";
import { createSagaActor } from "./fixtures/saga.ts";
import { createConditionalActor } from "./fixtures/conditional.ts";
import { serializeViz } from "@mantaq/viz";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { instrument } from "@mantaq/traversal";
import { describe, expect, test } from "vite-plus/test";

describe("toViz structure", () => {
  test("checkout: states, initial and final flags", () => {
    const doc = toViz([{ id: "checkout", actor: createCheckoutActor() }]);
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
    const machine = toViz([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    expect(machine?.events.find((e) => e.id === "paymentOk")?.internal).toBe(true);
    expect(machine?.events.find((e) => e.id === "back")?.internal).toBe(false);
    expect(machine?.edges.some((e) => e.kind === "effect" && e.from === "submitting")).toBe(true);
    expect(machine?.edges.find((e) => e.kind === "initial")?.to).toBe("basicInfo");
  });

  test("per-state handlers give exact source/target pairs", () => {
    const machine = toViz([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    const back = machine?.edges.filter((e) => e.event === "back").map((e) => `${e.from}->${e.to}`);
    expect(back?.sort()).toEqual([
      "error->payment",
      "payment->shippingAddress",
      "shippingAddress->basicInfo",
    ]);
  });

  test("onAny edges leave the any-state source once per declared target", () => {
    const machine = toViz([{ id: "saga", actor: createSagaActor() }]).machines[0];
    const cancel = machine?.edges.filter((e) => e.event === "CANCEL") ?? [];
    expect(cancel.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      "*->compensatingRelease",
      "*->failed",
    ]);
    expect(machine?.states.some((s) => s.id === "*")).toBe(false);
  });

  test("payload-dependent branch shows every declared target, not only the probed one", () => {
    const machine = toViz([{ id: "cond", actor: createConditionalActor() }]).machines[0];
    const targets = machine?.edges.filter((e) => e.event === "review").map((e) => e.to);
    expect(targets).toEqual(["approved", "rejected"]);
    expect(machine?.edges.find((e) => e.event === "review")?.explanation).toBeNull();
  });

  test("no history means null coverage and null payload types", () => {
    const machine = toViz([{ id: "checkout", actor: createCheckoutActor() }]).machines[0];
    expect(machine?.states.every((s) => s.coverage === null)).toBe(true);
    expect(machine?.edges.every((e) => e.coverage === null)).toBe(true);
    expect(machine?.events.every((e) => e.payload === null)).toBe(true);
  });
});

describe("determinism", () => {
  test("same machine serializes to byte-identical JSON", () => {
    const first = serializeViz(toViz([{ id: "checkout", actor: createCheckoutActor() }]));
    const second = serializeViz(toViz([{ id: "checkout", actor: createCheckoutActor() }]));
    expect(first).toBe(second);
  });

  test("input order does not change output", () => {
    const a = { id: "a", actor: createCheckoutActor() };
    const b = { id: "b", actor: createConditionalActor() };
    expect(serializeViz(toViz([a, b]))).toBe(serializeViz(toViz([b, a])));
  });

  test("auth snapshot", () => {
    expect(serializeViz(toViz([{ id: "auth", actor: createAuthActor() }]))).toMatchSnapshot();
  });

  test("saga snapshot", () => {
    expect(serializeViz(toViz([{ id: "saga", actor: createSagaActor() }]))).toMatchSnapshot();
  });

  test("checkout snapshot", () => {
    expect(
      serializeViz(toViz([{ id: "checkout", actor: createCheckoutActor() }])),
    ).toMatchSnapshot();
  });
});

describe("coverage", () => {
  test("example export has no undetermined edges: every target is declared", () => {
    for (const machine of toViz(exampleInputs()).machines) {
      expect(machine.edges.filter((e) => e.to === null)).toEqual([]);
    }
  });

  test("counts state visits and edge hits from instrumented run", () => {
    const run = instrument(createCheckoutActor());
    run.send(submitBasicInfo.create({ email: "a@b.c", name: "A" }));
    const machine = toViz([{ id: "checkout", actor: createCheckoutActor(), history: run.history }])
      .machines[0];
    expect(machine?.states.find((s) => s.id === "shippingAddress")?.coverage).toEqual({ hits: 1 });
    expect(machine?.states.find((s) => s.id === "payment")?.coverage).toEqual({ hits: 0 });
    const edge = machine?.edges.find(
      (e) => e.from === "basicInfo" && e.event === "submitBasicInfo",
    );
    expect(edge?.coverage).toEqual({ hits: 1 });
  });
});

describe("toViz outputs", () => {
  const idle = state("idle")();
  const go = event("go")();
  const x = event("x")();
  const y = event("y")();

  test("declared outputs are listed sorted by id", () => {
    const actor = Actor({
      inputs: [go],
      outputs: [y, x],
      states: [idle],
      initial: idle,
      clock: VirtualClock(),
      setup: () => {},
    });
    expect(toViz([{ id: "m", actor }]).machines[0]?.outputs).toEqual(["x", "y"]);
  });

  test("no declared outputs gives an empty list", () => {
    const actor = Actor({
      inputs: [go],
      states: [idle],
      initial: idle,
      clock: VirtualClock(),
      setup: () => {},
    });
    expect(toViz([{ id: "m", actor }]).machines[0]?.outputs).toEqual([]);
  });
});
