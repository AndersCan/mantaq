import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import type { AnyActor, Clock, Snapshot } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { embed } from "./embed.ts";
import { withTimeout } from "../effects/timeout.ts";

const working = state("working")();
const passed = state("passed")().final();
const unhandled = event("unhandled")();

interface BrokenCheckOptions {
  breaks: "on entry" | "later";
}

/** A child that enters `__error`: it emits an internal event no state handles. */
function brokenCheck(options: BrokenCheckOptions) {
  return machine("brokenCheck", {
    create: ({ clock }) =>
      Actor({
        inputs: [],
        internal: [unhandled],
        states: [working, passed],
        initial: working,
        clock,
        setup: (builder) => {
          builder.effect(working, {
            name: "break",
            sends: [unhandled],
            fn: (input) => {
              if (options.breaks === "on entry") input.emit(unhandled.create());
              else withTimeout(50, { input, event: () => unhandled.create() });
            },
          });
        },
      }),
  });
}

const looseCheck = machine("looseCheck", {
  create: ({ clock }): AnyActor<unknown> =>
    Actor({ inputs: [], states: [passed], initial: passed, clock, setup: () => {} }),
});

const idle = state("idle")();
const checking = state("checking")();
const accepted = state("accepted")();
const broken = state("broken")();
const start = event("start")();
const checkPassed = event("checkPassed")();
const checkBroke = event("checkBroke")();

function parentOf(clock: Clock, check: ReturnType<typeof brokenCheck>) {
  return Actor({
    inputs: [start],
    internal: [checkPassed, checkBroke],
    states: [idle, checking, accepted, broken],
    initial: idle,
    clock,
    setup: (builder) => {
      builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
      embed(builder, {
        in: checking,
        machine: check,
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
}

const retry = event("retry")();
const dismiss = event("dismiss")();
const checkChanged = event("checkChanged")<Snapshot>();

interface AskingOptions {
  retried: "moves on" | "fails";
}

const failing = state("failing")();
const finish = event("finish")();

/** A child that ends on its own after 50 ms; `retry` ends it at once or sends it into `__error`. */
function askingCheck(options: AskingOptions) {
  const afterRetry = options.retried === "fails" ? failing : passed;
  return machine("askingCheck", {
    create: ({ clock }) =>
      Actor({
        inputs: [retry, dismiss],
        internal: [finish, unhandled],
        states: [working, failing, passed],
        initial: working,
        clock,
        setup: (builder) => {
          builder.effect(working, {
            name: "wait",
            sends: [finish],
            fn: (input) => withTimeout(50, { input, event: () => finish.create() }),
          });
          builder.on(working, { event: finish, to: [passed], handler: () => ({ state: passed }) });
          builder.on(working, {
            event: retry,
            to: [passed, failing],
            handler: () => ({ state: afterRetry }),
          });
          builder.effect(failing, {
            name: "break",
            sends: [unhandled],
            fn: (input) => input.emit(unhandled.create()),
          });
        },
      }),
  });
}

function askingParent(clock: Clock, options: AskingOptions) {
  return Actor({
    inputs: [start, retry, dismiss],
    internal: [checkPassed, checkBroke],
    states: [idle, checking, accepted, broken],
    initial: idle,
    clock,
    setup: (builder) => {
      builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
      embed(builder, {
        in: checking,
        machine: askingCheck(options),
        done: { passed: checkPassed },
        error: checkBroke,
        forward: [retry, dismiss],
      });
      builder.on(checking, {
        event: checkPassed,
        to: [accepted],
        handler: () => ({ state: accepted }),
      });
      builder.on(checking, { event: checkBroke, to: [broken], handler: () => ({ state: broken }) });
    },
  });
}

const settling = state("settling")().final();

const lateFailure = machine("lateFailure", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      states: [settling],
      initial: settling,
      clock,
      setup: (builder) => {
        builder.effect(settling, {
          name: "failLate",
          fn: () => Promise.reject(new Error("late")),
        });
      },
    }),
});

describe("embed errors", () => {
  test("a child that fails after it ended sends no second event", async () => {
    const received: string[] = [];
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkBroke],
      states: [idle, checking],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: lateFailure,
          done: { settling: checkPassed },
          error: checkBroke,
        });
        for (const mapped of [checkPassed, checkBroke]) {
          builder.on(checking, { event: mapped, handler: (sent) => void received.push(sent.type) });
        }
      },
    });

    actor.send(start.create());
    await actor.settled();
    await Promise.resolve();

    expect(received).toEqual(["checkPassed"]);
  });

  test("a child that enters __error sends the error event, not a done event", () => {
    const clock = VirtualClock();
    const actor = parentOf(clock, brokenCheck({ breaks: "later" }));
    actor.send(start.create());

    clock.advance(50);

    expect(actor.state.name).toBe("broken");
  });

  test("a child that enters __error while it is built sends the error event on entry", () => {
    const actor = parentOf(VirtualClock(), brokenCheck({ breaks: "on entry" }));

    actor.send(start.create());

    expect(actor.state.name).toBe("broken");
  });

  test("disposing the parent disposes the child", () => {
    const clock = VirtualClock();
    const actor = parentOf(clock, brokenCheck({ breaks: "later" }));
    actor.send(start.create());

    actor.dispose();

    expect(clock.hasPending()).toBe(false);
  });

  test("an untyped child that ends in a final state the parent did not map sends the error event", () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkBroke],
      states: [idle, checking, broken],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, { in: checking, machine: looseCheck, done: {}, error: checkBroke });
        builder.on(checking, {
          event: checkBroke,
          to: [broken],
          handler: () => ({ state: broken }),
        });
      },
    });

    actor.send(start.create());

    expect(actor.state.name).toBe("broken");
  });

  test("a parent without a clock sends the error event and never builds the child", () => {
    let built = 0;
    const counted = machine("counted", {
      create: ({ clock }) => {
        built += 1;
        return Actor({ inputs: [], states: [passed], initial: passed, clock, setup: () => {} });
      },
    });
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkBroke],
      states: [idle, checking, accepted, broken],
      initial: idle,
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        // @ts-expect-error -- a parent without a clock: the types refuse it, a JS caller can still do it
        embed(builder, {
          in: checking,
          machine: counted,
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

    actor.send(start.create());

    expect({ state: actor.state.name, built }).toEqual({ state: "broken", built: 0 });
  });

  test("a forwarded input that sends the child into __error sends the error event", () => {
    const actor = askingParent(VirtualClock(), { retried: "fails" });
    actor.send(start.create());

    actor.send(retry.create());

    expect(actor.state.name).toBe("broken");
  });

  test("a forwarded input after the child ended reaches nothing", () => {
    const received: string[] = [];
    const actor = Actor({
      inputs: [start, retry],
      internal: [checkPassed, checkBroke],
      states: [idle, checking],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: askingCheck({ retried: "fails" }),
          done: { passed: checkPassed },
          error: checkBroke,
          forward: [retry],
        });
        for (const mapped of [checkPassed, checkBroke]) {
          builder.on(checking, { event: mapped, handler: (sent) => void received.push(sent.type) });
        }
      },
    });
    actor.send(start.create());
    actor.send(retry.create());

    actor.send(retry.create());

    expect({ state: actor.state.name, received }).toEqual({
      state: "checking",
      received: ["checkBroke"],
    });
  });

  test("a parent without a clock has no child, so a forwarded input changes nothing", () => {
    const actor = Actor({
      inputs: [start, retry],
      internal: [checkPassed, checkBroke],
      states: [idle, checking, accepted],
      initial: idle,
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        // @ts-expect-error -- a parent without a clock: the types refuse it, a JS caller can still do it
        embed(builder, {
          in: checking,
          machine: askingCheck({ retried: "moves on" }),
          done: { passed: checkPassed },
          error: checkBroke,
          forward: [retry],
        });
        builder.on(checking, { event: checkBroke, handler: () => {} });
        builder.on(checking, {
          event: checkPassed,
          to: [accepted],
          handler: () => ({ state: accepted }),
        });
      },
    });
    actor.send(start.create());

    actor.send(retry.create());

    expect(actor.state.name).toBe("checking");
  });

  test("a parent that does not handle its snapshot event in the embedding state enters __error", () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkBroke, checkChanged],
      states: [idle, checking],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: askingCheck({ retried: "moves on" }),
          done: { passed: checkPassed },
          error: checkBroke,
          snapshot: checkChanged,
        });
      },
    });

    actor.send(start.create());

    expect({ state: actor.state.name, event: actor.snapshot().error?.event.type }).toEqual({
      state: "__error",
      event: "checkChanged",
    });
  });
});
