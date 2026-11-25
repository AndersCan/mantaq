import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import type { AnyActor, Snapshot } from "@mantaq/core";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { embed } from "./embed.ts";
import type { Embedded } from "./embed.ts";

const working = state("working")();
const passed = state("passed")().final();
const failed = state("failed")().final();
const progress = event("progress")();

const check = machine("check", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      outputs: [progress],
      states: [working, passed, failed],
      initial: working,
      clock,
      setup: () => {},
    }),
});

const wrappedCheck = machine("wrappedCheck", {
  create: ({ clock }) => ({ actor: check.create({ clock }) }),
});

const checkWithParts = machine("checkWithParts", {
  create: ({ clock }) => ({ actor: check.create({ clock }), log: check.create({ clock }) }),
});

const idle = state("idle")();
const closed = state("closed")().final();
const start = event("start")();
const checkPassed = event("checkPassed")();
const checkFailed = event("checkFailed")();
const checkBroke = event("checkBroke")();
const checkScored = event("checkScored")<{ score: number }>();
const retry = event("retry")();
const dismiss = event("dismiss")();
const rate = event("rate")<{ score: number }>();
const rateWithoutScore = event("rate")();
const checkChanged = event("checkChanged")<Snapshot>();
const checkNamed = event("checkNamed")<{ name: string }>();

const askingCheck = machine("askingCheck", {
  create: ({ clock }) =>
    Actor({
      inputs: [retry, rate],
      states: [working, passed],
      initial: working,
      clock,
      setup: () => {},
    }),
});

describe("embed types", () => {
  test("a parent with a clock, a total done map and internal void events typechecks", () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkFailed, checkBroke],
      outputs: [progress],
      states: [idle, closed],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          machine: check,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
        embed(builder, {
          in: idle,
          machine: wrappedCheck,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
      },
    });
    expectTypeOf(embed).returns.toBeVoid();
    expectTypeOf<Embedded["done"]>().toEqualTypeOf<Readonly<Record<string, string>>>();
    expect(actor.options.effects["idle"]?.length).toBe(2);
  });

  test("wrong options do not typecheck", () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkFailed, checkBroke, checkScored],
      outputs: [progress],
      states: [idle, closed],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          machine: check,
          // @ts-expect-error -- done names every final state of the child; `failed` is missing
          done: { passed: checkPassed },
          error: checkBroke,
        });
        embed(builder, {
          in: idle,
          machine: check,
          // @ts-expect-error -- a mapped event is internal; an input would not be one the effect may send
          done: { passed: start, failed: checkFailed },
          error: checkBroke,
        });
        embed(builder, {
          in: idle,
          machine: check,
          done: { passed: checkPassed, failed: checkFailed },
          // @ts-expect-error -- a mapped event carries no payload; embed has none to give it
          error: checkScored,
        });
        embed(builder, {
          // @ts-expect-error -- a final state cannot run a child
          in: closed,
          machine: check,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
        embed(builder, {
          in: idle,
          // @ts-expect-error -- embed disposes only `actor`, so a factory may return nothing else
          machine: checkWithParts,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
      },
    });
    expect(actor.state.name).toBe("idle");
  });

  test("a child output the parent does not declare does not typecheck", () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkFailed, checkBroke],
      states: [idle, closed],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          // @ts-expect-error -- the child sends `progress` and this parent does not declare it
          machine: check,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
      },
    });
    expect(actor.state.name).toBe("idle");
  });

  test("an untyped child needs no done entries and takes every forwarded input", () => {
    const loose = machine("loose", {
      create: ({ clock }): AnyActor<unknown> => check.create({ clock }),
    });
    const actor = Actor({
      inputs: [start],
      internal: [checkBroke],
      states: [idle, closed],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          machine: loose,
          done: {},
          error: checkBroke,
          forward: [start],
        });
      },
    });
    expect(actor.state.name).toBe("idle");
  });

  test("forward takes parent inputs that the child takes, snapshot takes an internal event that carries a snapshot", () => {
    const actor = Actor({
      inputs: [retry, rate],
      internal: [checkPassed, checkBroke, checkChanged],
      states: [idle, closed],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          forward: [retry, rate],
          snapshot: checkChanged,
        });
      },
    });
    expectTypeOf<Embedded["forward"]>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<Embedded["snapshot"]>().toEqualTypeOf<string | undefined>();
    expect(actor.options.transitions["idle"]).toHaveProperty("retry");
  });

  test("keep names a context field that takes the child snapshot", () => {
    interface WatchingContext {
      check: Snapshot | undefined;
      attempts: number;
    }
    const watching: WatchingContext = { check: undefined, attempts: 0 };
    const actor = Actor({
      inputs: [],
      internal: [checkPassed, checkBroke, checkChanged],
      states: [idle, closed],
      initial: closed,
      context: watching,
      clock: VirtualClock(),
      setup: (builder) => {
        const endings = { machine: askingCheck, done: { passed: checkPassed }, error: checkBroke };
        embed(builder, { in: idle, ...endings, snapshot: checkChanged, keep: "check" });
        // @ts-expect-error -- `attempts` holds a number, not the child snapshot
        embed(builder, { in: idle, ...endings, snapshot: checkChanged, keep: "attempts" });
        // @ts-expect-error -- the context has no `missing` field
        embed(builder, { in: idle, ...endings, snapshot: checkChanged, keep: "missing" });
      },
    });
    expectTypeOf<Embedded["keep"]>().toEqualTypeOf<string | undefined>();
    expect(actor.state.name).toBe("closed");
  });

  test("wrong forward and snapshot options do not typecheck", () => {
    const actor = Actor({
      inputs: [retry, dismiss, rateWithoutScore],
      internal: [checkPassed, checkBroke, checkNamed],
      outputs: [checkChanged],
      states: [idle, closed],
      initial: closed,
      clock: VirtualClock(),
      setup: (builder) => {
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- the child has no `dismiss` input
          forward: [retry, dismiss],
        });
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- the child `rate` input needs a score that the parent `rate` does not carry
          forward: [rateWithoutScore],
        });
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- only a parent input goes on to the child; `checkPassed` is internal
          forward: [checkPassed],
        });
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- the payload of the snapshot event must take a child snapshot
          snapshot: checkNamed,
        });
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- an event without a payload has no room for the snapshot
          snapshot: checkPassed,
        });
        embed(builder, {
          in: idle,
          machine: askingCheck,
          done: { passed: checkPassed },
          error: checkBroke,
          // @ts-expect-error -- the snapshot event is internal, so the parent records it; an output would only pass by
          snapshot: checkChanged,
        });
      },
    });
    expect(actor.state.name).toBe("closed");
  });
});
