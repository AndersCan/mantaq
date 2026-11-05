import { exampleTargets, handWrittenBaselines } from "../examples.ts";
import { withTestCoverage } from "./coverage.ts";
import { createConditionalActor } from "../fixtures/conditional.ts";
import { createStateRoutingActor } from "../fixtures/state-routing.ts";
import { serializeViz, VIZ_SCHEMA_VERSION, parseViz } from "@mantaq/viz";
import type { VizStep } from "@mantaq/viz";
import { fuzz, shrink } from "./fuzz.ts";
import { execute } from "./run.ts";
import type { FuzzTarget } from "./run.ts";
import { fuzzedMachine } from "./to-viz.ts";
import { DEFAULT_SEED } from "@mantaq/pbt";
import { VirtualClock } from "@mantaq/core";
import { Either } from "@mantaq/utils";
import { describe, expect, test } from "vite-plus/test";

const ITERATIONS = 2000;

function featuresOfAll(
  target: FuzzTarget,
  sequences: ReadonlyArray<ReadonlyArray<VizStep>>,
): Set<string> {
  return new Set(sequences.flatMap((steps) => execute(target, steps).features));
}

describe("fuzz reaches hand-written test coverage", () => {
  const baselines = handWrittenBaselines();
  for (const target of exampleTargets()) {
    test(target.id, () => {
      const wanted = featuresOfAll(target, baselines[target.id] ?? []);
      expect(wanted.size).toBeGreaterThan(0);
      const result = fuzz(target, { seed: DEFAULT_SEED, iterations: ITERATIONS });
      const reached = featuresOfAll(
        target,
        result.corpus.map((entry) => entry.steps),
      );
      expect([...wanted].filter((feature) => !reached.has(feature))).toEqual([]);
      expect(reached.size).toBeGreaterThan(wanted.size);
    });
  }
});

describe("fuzz write-back", () => {
  const checkout = exampleTargets().find((target) => target.id === "checkout");

  test("fuzzing marks which declared back edges the live machine takes", () => {
    if (!checkout) return;
    const machine = fuzzedMachine(
      checkout,
      fuzz(checkout, { seed: DEFAULT_SEED, iterations: ITERATIONS }),
    );
    const back = machine.edges.filter((edge) => edge.event === "back");
    expect(back.some((edge) => edge.origin === "fuzz" && edge.kind === "transition")).toBe(false);
    const found = back
      .filter((edge) => edge.kind === "transition" && (edge.coverage?.hits ?? 0) > 0)
      .map((edge) => `${edge.from}->${edge.to}`)
      .sort();
    expect(found).toEqual([
      "error->payment",
      "payment->shippingAddress",
      "shippingAddress->basicInfo",
    ]);
    // Unhandled in basicInfo: the event is ignored, so no edge is drawn there.
    expect(back.some((edge) => edge.from === "basicInfo")).toBe(false);
  });

  test("a stay from an onAny handler is drawn once from the any-state source", () => {
    const routing: FuzzTarget = {
      id: "routing",
      create: () => {
        const clock = VirtualClock();
        return { actor: createStateRoutingActor(clock), clock };
      },
      payloads: {},
    };
    const machine = fuzzedMachine(routing, fuzz(routing, { seed: DEFAULT_SEED, iterations: 200 }));
    const stays = machine.edges.filter((edge) => edge.kind === "stay");
    expect(stays.map((edge) => `${edge.origin}:${edge.from}->${edge.to}`)).toEqual(["fuzz:*->*"]);
    expect(stays[0]?.coverage?.hits).toBeGreaterThan(0);
  });

  test("coverage filled, fuzz summary present, document validates", () => {
    if (!checkout) return;
    const machine = fuzzedMachine(
      checkout,
      fuzz(checkout, { seed: DEFAULT_SEED, iterations: ITERATIONS }),
    );
    expect(machine.states.every((state) => (state.coverage?.hits ?? 0) > 0)).toBe(true);
    expect(machine.fuzz?.seed).toBe(DEFAULT_SEED);
    expect(machine.fuzz?.corpus.length).toBeGreaterThan(0);
    const text = serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    expect(Either.isRight(parseViz(text))).toBe(true);
  });

  test("payload-dependent branch hidden from probing is declared, and fuzzing reaches it", () => {
    const conditional: FuzzTarget = {
      id: "conditional",
      create: () => {
        const clock = VirtualClock();
        return { actor: createConditionalActor(clock), clock };
      },
      payloads: { review: [{ amount: 50 }] },
    };
    const machine = fuzzedMachine(
      conditional,
      fuzz(conditional, { seed: DEFAULT_SEED, iterations: 300 }),
    );
    const review = machine.edges.filter((edge) => edge.event === "review");
    expect(review.map((edge) => `${edge.origin}:${edge.to}`).sort()).toEqual([
      "declared:approved",
      "declared:rejected",
    ]);
    expect(review.find((edge) => edge.to === "rejected")?.coverage?.hits).toBeGreaterThan(0);
  });
});

describe("determinism and replay", () => {
  test("same seed => byte-identical viz; different seed => different corpus", () => {
    for (const target of exampleTargets()) {
      const run = (seed: number) =>
        serializeViz({
          schemaVersion: VIZ_SCHEMA_VERSION,
          machines: [fuzzedMachine(target, fuzz(target, { seed, iterations: 500 }))],
        });
      expect(run(DEFAULT_SEED)).toBe(run(DEFAULT_SEED));
      expect(run(DEFAULT_SEED)).not.toBe(run(DEFAULT_SEED + 1));
    }
  });

  test("every kept sequence replays to the features it was kept for", () => {
    for (const seed of [1, 2, 3]) {
      for (const target of exampleTargets()) {
        for (const entry of fuzz(target, { seed, iterations: 300 }).corpus) {
          const reached = execute(target, entry.steps).features;
          expect(entry.discovered.filter((feature) => !reached.includes(feature))).toEqual([]);
        }
      }
    }
  });

  test("kept sequences are 1-minimal: dropping any step loses a feature", () => {
    for (const target of exampleTargets()) {
      for (const entry of fuzz(target, { seed: DEFAULT_SEED, iterations: 300 }).corpus) {
        expect(shrink(target, entry.steps, entry.discovered)).toEqual(entry.steps);
        entry.steps.forEach((_, drop) => {
          const fewer = entry.steps.filter((__, index) => index !== drop);
          const reached = execute(target, fewer).features;
          expect(entry.discovered.every((feature) => reached.includes(feature))).toBe(false);
        });
      }
    }
  });
});

describe("test coverage", () => {
  test("tested counts what the example tests exercise", () => {
    const checkout = exampleTargets().find((target) => target.id === "checkout");
    if (!checkout) return;
    const fuzzed = fuzzedMachine(
      checkout,
      fuzz(checkout, { seed: DEFAULT_SEED, iterations: 2000 }),
    );
    const machine = withTestCoverage(checkout, fuzzed, handWrittenBaselines()["checkout"] ?? []);
    const state = (id: string) => machine.states.find((each) => each.id === id)?.tested;
    // Five test starts plus one `back` from shippingAddress.
    expect(state("basicInfo")).toEqual({ hits: 6 });
    // Only the timeout test reaches error; none fires paymentFail.
    expect(state("error")).toEqual({ hits: 1 });
    const edge = (from: string, kind: string, to: string) =>
      machine.edges.find(
        (each) =>
          each.from === from && each.event === "back" && each.kind === kind && each.to === to,
      );
    expect(edge("shippingAddress", "transition", "basicInfo")?.tested).toEqual({ hits: 1 });
    expect(edge("payment", "transition", "shippingAddress")?.tested).toEqual({ hits: 1 });
    expect(edge("error", "transition", "payment")?.tested).toEqual({ hits: 0 });
    expect(
      machine.edges.filter((each) => each.kind === "effect").every((each) => each.tested === null),
    ).toBe(true);
    const text = serializeViz({ schemaVersion: VIZ_SCHEMA_VERSION, machines: [machine] });
    expect(Either.getRight(parseViz(text))?.machines[0]).toEqual(machine);
  });
});

describe("loops over context-changing steps", () => {
  const retry = exampleTargets().find((target) => target.id === "retry");
  const lockout = "edge:connecting>failed>lockedOut";

  test("only steps that changed context are loop candidates", () => {
    if (!retry) return;
    const step = (event: string) => ({ kind: "event" as const, event, payload: null });
    const failed = { kind: "event" as const, event: "failed", payload: { reason: "x" } };
    // connect: state change, no context change. failed: attempts += 1. reset: unhandled in connecting.
    const trace = execute(retry, [step("connect"), failed, step("reset"), failed]);
    expect(trace.contextSteps).toEqual([1, 3]);
  });

  test("`attempts > 10` is reached by looping; plain mutation misses it (same seed)", () => {
    if (!retry) return;
    const looped = fuzz(retry, { seed: DEFAULT_SEED, iterations: 2000 });
    const plain = fuzz(retry, { seed: DEFAULT_SEED, iterations: 2000, repeat: false });
    expect(looped.firstHit.has(lockout)).toBe(true);
    expect(plain.firstHit.has(lockout)).toBe(false);
  });

  test("the kept sequence shrinks to connect + exactly 11 failures", () => {
    if (!retry) return;
    const entry = fuzz(retry, { seed: DEFAULT_SEED, iterations: 2000 }).corpus.find((each) =>
      each.discovered.includes(lockout),
    );
    const events = entry?.steps.map((step) => (step.kind === "event" ? step.event : "advance"));
    expect(events).toEqual(["connect", ...Array.from({ length: 11 }, () => "failed")]);
  });
});

describe("fuzz initial corpus", () => {
  const target = exampleTargets()[0];
  const baseline = target ? (handWrittenBaselines()[target.id] ?? []) : [];

  test("initial sequences seed the corpus at iteration 0", () => {
    if (!target) throw new Error("no example targets");
    const wanted = featuresOfAll(target, baseline);
    const result = fuzz(target, { seed: DEFAULT_SEED, iterations: 0, initial: baseline });
    const reached = featuresOfAll(
      target,
      result.corpus.map((entry) => entry.steps),
    );
    expect([...wanted].filter((feature) => !reached.has(feature))).toEqual([]);
  });

  test("seeded runs are reproducible per seed", () => {
    if (!target) throw new Error("no example targets");
    const run = () => fuzz(target, { seed: 7, iterations: 200, initial: baseline });
    expect(run().corpus).toEqual(run().corpus);
  });

  test("no initial sequences matches the unseeded run", () => {
    if (!target) throw new Error("no example targets");
    const options = { seed: 7, iterations: 200 };
    expect(fuzz(target, { ...options, initial: [] }).corpus).toEqual(fuzz(target, options).corpus);
  });

  test("seeding with iterations still changes the corpus", () => {
    if (!target) throw new Error("no example targets");
    const options = { seed: 7, iterations: 50 };
    const seeded = fuzz(target, { ...options, initial: baseline });
    const sequences = (result: typeof seeded) => result.corpus.map((entry) => entry.steps);
    expect(sequences(seeded)).not.toEqual(sequences(fuzz(target, options)));
    expect(seeded.corpus.some((entry) => entry.iteration === 0)).toBe(true);
  });
});
