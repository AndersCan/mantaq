import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import type { AnyActor } from "@mantaq/core";
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

  test("an untyped child needs no done entries", () => {
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
        embed(builder, { in: idle, machine: loose, done: {}, error: checkBroke });
      },
    });
    expect(actor.state.name).toBe("idle");
  });
});
