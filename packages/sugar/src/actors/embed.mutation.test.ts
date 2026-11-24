import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { embed } from "./embed.ts";
import { withTimeout } from "../effects/timeout.ts";

const working = state("working")();
const passed = state("passed")().final();
const finish = event("finish")();

const check = machine("check", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [finish],
      states: [working, passed],
      initial: working,
      clock,
      setup: (builder) => {
        builder.effect(working, {
          name: "wait",
          sends: [finish],
          fn: (input) => withTimeout(50, { input, event: () => finish.create() }),
        });
        builder.on(working, { event: finish, to: [passed], handler: () => ({ state: passed }) });
      },
    }),
});

const wrappedCheck = machine("wrappedCheck", {
  create: ({ clock }) => ({ actor: check.create({ clock }) }),
});

const checking = state("checking")();
const accepted = state("accepted")();
const broken = state("broken")();
const checkPassed = event("checkPassed")();
const checkBroke = event("checkBroke")();

function parentOf(child: typeof wrappedCheck) {
  const clock = VirtualClock();
  const actor = Actor({
    inputs: [],
    internal: [checkPassed, checkBroke],
    states: [checking, accepted, broken],
    initial: checking,
    clock,
    setup: (builder) => {
      embed(builder, {
        in: checking,
        machine: child,
        done: { passed: checkPassed },
        error: checkBroke,
      });
      builder.on(checking, {
        event: checkPassed,
        to: [accepted],
        handler: () => ({ state: accepted }),
      });
      builder.on(checking, { event: checkBroke, to: [broken], handler: () => ({ state: broken }) });
    },
  });
  return { actor, clock };
}

describe("embed mutation", () => {
  test("a factory that returns { actor } runs that actor as the child", () => {
    const { actor, clock } = parentOf(wrappedCheck);

    clock.advance(50);

    expect(actor.state.name).toBe("accepted");
  });

  test("the effect entry names the machine, lists the mapped events and carries the tag", () => {
    const { actor } = parentOf(wrappedCheck);
    const [entry] = actor.options.effects["checking"] ?? [];

    expect({
      name: entry?.name,
      sends: entry?.sends,
      embedded: Reflect.get(entry?.fn ?? {}, "embedded"),
    }).toEqual({
      name: "embed:wrappedCheck",
      sends: ["checkPassed", "checkBroke"],
      embedded: { machine: wrappedCheck, done: { passed: "checkPassed" }, error: "checkBroke" },
    });
  });

  test("a parent without a clock sends the error event", () => {
    const actor = Actor({
      inputs: [],
      internal: [checkPassed, checkBroke],
      states: [checking, accepted, broken],
      initial: checking,
      setup: (builder) => {
        // @ts-expect-error -- a parent without a clock: the types refuse it, a JS caller can still do it
        embed(builder, {
          in: checking,
          machine: check,
          done: { passed: checkPassed },
          error: checkBroke,
        });
        builder.on(checking, {
          event: checkBroke,
          to: [broken],
          handler: () => ({ state: broken }),
        });
      },
    });

    expect(actor.state.name).toBe("broken");
  });
});
