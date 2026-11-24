import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { embed } from "./embed.ts";
import type { InternalEvent } from "@mantaq/core";
import { withTimeout } from "../effects/timeout.ts";

const working = state("working")();
const passed = state("passed")().final();
const failed = state("failed")().final();
const finish = event("finish")();
const progress = event("progress")<{ percent: number }>();

interface CheckOptions {
  outcome: "passed" | "failed" | "starts passed";
  waitMs: number;
}

function checkMachine(options: CheckOptions) {
  const ending = options.outcome === "failed" ? failed : passed;
  const initial = options.outcome === "starts passed" ? passed : working;
  return machine("check", {
    create: ({ clock }) =>
      Actor({
        inputs: [],
        internal: [finish],
        outputs: [progress],
        states: [working, passed, failed],
        initial,
        clock,
        setup: (builder) => {
          builder.effect(working, {
            name: "wait",
            sends: [finish],
            fn: (input) => withTimeout(options.waitMs, { input, event: () => finish.create() }),
          });
          builder.on(working, {
            event: finish,
            to: [passed, failed],
            handler: () => ({ state: ending, emit: [progress.create({ percent: 100 })] }),
          });
        },
      }),
  });
}

const idle = state("idle")();
const checking = state("checking")();
const accepted = state("accepted")();
const rejected = state("rejected")();
const broken = state("broken")();
const start = event("start")();
const cancel = event("cancel")();
const checkPassed = event("checkPassed")();
const checkFailed = event("checkFailed")();
const checkBroke = event("checkBroke")();

function parentOf(check: ReturnType<typeof checkMachine>) {
  const clock = VirtualClock();
  const outputs: InternalEvent[] = [];
  const actor = Actor({
    inputs: [start, cancel],
    internal: [checkPassed, checkFailed, checkBroke],
    outputs: [progress],
    states: [idle, checking, accepted, rejected, broken],
    initial: idle,
    clock,
    setup: (builder) => {
      builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
      embed(builder, {
        in: checking,
        machine: check,
        done: { passed: checkPassed, failed: checkFailed },
        error: checkBroke,
      });
      builder.on(checking, {
        event: checkPassed,
        to: [accepted],
        handler: () => ({ state: accepted }),
      });
      builder.on(checking, {
        event: checkFailed,
        to: [rejected],
        handler: () => ({ state: rejected }),
      });
      builder.on(checking, { event: checkBroke, to: [broken], handler: () => ({ state: broken }) });
      builder.on(checking, { event: cancel, to: [idle], handler: () => ({ state: idle }) });
      builder.on(accepted, { event: start, to: [checking], handler: () => ({ state: checking }) });
    },
  });
  actor.on("output", { fn: (output) => outputs.push(output) });
  return { actor, clock, outputs };
}

const fetched = machine("fetched", {
  create: ({ clock }) =>
    Actor({
      inputs: [],
      internal: [finish],
      states: [working, passed, failed],
      initial: working,
      clock,
      setup: (builder) => {
        builder.effect(working, {
          name: "fetch",
          sends: [finish],
          fn: (input) => Promise.resolve().then(() => input.emit(finish.create())),
        });
        builder.on(working, { event: finish, to: [passed], handler: () => ({ state: passed }) });
      },
    }),
});

describe("embed", () => {
  test("parent settled() waits for the async work of the child", async () => {
    const actor = Actor({
      inputs: [start],
      internal: [checkPassed, checkFailed, checkBroke],
      states: [idle, checking, accepted, rejected, broken],
      initial: idle,
      clock: VirtualClock(),
      setup: (builder) => {
        builder.on(idle, { event: start, to: [checking], handler: () => ({ state: checking }) });
        embed(builder, {
          in: checking,
          machine: fetched,
          done: { passed: checkPassed, failed: checkFailed },
          error: checkBroke,
        });
        builder.on(checking, {
          event: checkPassed,
          to: [accepted],
          handler: () => ({ state: accepted }),
        });
      },
    });
    actor.send(start.create());

    await actor.settled();

    expect(actor.state.name).toBe("accepted");
  });

  test("a child final state sends its mapped event, after the child outputs of that step", () => {
    const { actor, clock, outputs } = parentOf(checkMachine({ outcome: "failed", waitMs: 50 }));
    actor.send(start.create());
    clock.advance(49);
    const before = { state: actor.state.name, outputs: [...outputs] };
    clock.advance(1);

    expect([before, { state: actor.state.name, outputs }]).toEqual([
      { state: "checking", outputs: [] },
      { state: "rejected", outputs: [{ type: "progress", payload: { percent: 100 } }] },
    ]);
  });

  test("leaving the state disposes the child, so its timer never fires", () => {
    const { actor, clock, outputs } = parentOf(checkMachine({ outcome: "passed", waitMs: 50 }));
    actor.send(start.create());
    actor.send(cancel.create());

    clock.advance(100);

    expect({ state: actor.state.name, pending: clock.hasPending(), outputs }).toEqual({
      state: "idle",
      pending: false,
      outputs: [],
    });
  });

  test("entering the state again builds a fresh child", () => {
    const { actor, clock } = parentOf(checkMachine({ outcome: "passed", waitMs: 50 }));
    actor.send(start.create());
    clock.advance(50);
    actor.send(start.create());
    clock.advance(10);
    const before = actor.state.name;
    clock.advance(40);

    expect([before, actor.state.name]).toEqual(["checking", "accepted"]);
  });

  test("a child that starts in a final state sends its event on entry", () => {
    const { actor } = parentOf(checkMachine({ outcome: "starts passed", waitMs: 50 }));

    actor.send(start.create());

    expect(actor.state.name).toBe("accepted");
  });

  test("the effect fn carries the machine and the mapping, and sends lists the mapped events", () => {
    const check = checkMachine({ outcome: "passed", waitMs: 50 });
    const { actor } = parentOf(check);
    const [entry] = actor.options.effects["checking"] ?? [];

    expect({
      name: entry?.name,
      sends: entry?.sends,
      embedded: Reflect.get(entry?.fn ?? {}, "embedded"),
    }).toEqual({
      name: "embed:check",
      sends: ["checkPassed", "checkFailed", "checkBroke"],
      embedded: {
        machine: check,
        done: { passed: "checkPassed", failed: "checkFailed" },
        error: "checkBroke",
      },
    });
  });
});
