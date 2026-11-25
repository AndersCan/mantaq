import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { fc, runProperty } from "@mantaq/pbt";
import { embed } from "./embed.ts";
import type { InternalEvent } from "@mantaq/core";
import { withTimeout } from "../effects/timeout.ts";

type Outcome = "passed" | "failed" | "broken" | "starts passed";
type Step =
  | { kind: "start" }
  | { kind: "cancel" }
  | { kind: "retry" }
  | { kind: "hurry" }
  | { kind: "advance"; ms: number };
type ParentState = "idle" | "checking" | "accepted" | "rejected" | "broken";

const anyStep: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.constant<Step>({ kind: "start" }), weight: 2 },
  { arbitrary: fc.constant<Step>({ kind: "cancel" }), weight: 1 },
  { arbitrary: fc.constant<Step>({ kind: "retry" }), weight: 3 },
  { arbitrary: fc.constant<Step>({ kind: "hurry" }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.integer({ min: 0, max: 30 }),
    }),
    weight: 4,
  },
);

const anyRun = fc.record({
  outcome: fc.constantFrom<Outcome>("passed", "failed", "broken", "starts passed"),
  waitMs: fc.integer({ min: 20, max: 100 }),
  steps: fc.array(anyStep, { maxLength: 40, size: "max" }),
});

const working = state("working")();
const passed = state("passed")().final();
const failed = state("failed")().final();
const finish = event("finish")();
const unhandled = event("unhandled")();
const progress = event("progress")();
const retry = event("retry")();
const hurry = event("hurry")();

interface CheckOptions {
  outcome: Outcome;
  waitMs: number;
}

function checkMachine(options: CheckOptions) {
  const { outcome, waitMs } = options;
  const ending = outcome === "failed" ? failed : passed;
  const raised = outcome === "broken" ? unhandled : finish;
  return machine("check", {
    create: ({ clock }) =>
      Actor({
        inputs: [retry, hurry],
        internal: [finish, unhandled],
        outputs: [progress],
        states: [working, passed, failed],
        initial: outcome === "starts passed" ? passed : working,
        clock,
        setup: (builder) => {
          builder.effect(working, {
            name: "wait",
            sends: [finish, unhandled],
            fn: (input) => withTimeout(waitMs, { input, event: () => raised.create() }),
          });
          for (const ends of [finish, hurry]) {
            builder.on(working, {
              event: ends,
              to: [passed, failed],
              handler: () => ({ state: ending, emit: [progress.create()] }),
            });
          }
          builder.on(working, { event: retry, to: [working], handler: () => ({ state: working }) });
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

function parentOf(options: CheckOptions) {
  const clock = VirtualClock();
  const outputs: InternalEvent[] = [];
  const actor = Actor({
    inputs: [start, cancel, retry, hurry],
    internal: [checkPassed, checkFailed, checkBroke],
    outputs: [progress],
    states: [idle, checking, accepted, rejected, broken],
    initial: idle,
    clock,
    setup: (builder) => {
      for (const resting of [idle, accepted, rejected, broken]) {
        builder.on(resting, { event: start, to: [checking], handler: () => ({ state: checking }) });
      }
      embed(builder, {
        in: checking,
        machine: checkMachine(options),
        done: { passed: checkPassed, failed: checkFailed },
        error: checkBroke,
        forward: [retry, hurry],
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
    },
  });
  actor.on("output", { fn: (output) => outputs.push(output) });
  function drive(step: Step): void {
    switch (step.kind) {
      case "start":
        return actor.send(start.create());
      case "cancel":
        return actor.send(cancel.create());
      case "retry":
        return actor.send(retry.create());
      case "hurry":
        return actor.send(hurry.create());
      case "advance":
        return clock.advance(step.ms);
      default:
        return step satisfies never;
    }
  }
  return { actor, clock, outputs, drive };
}

const endingOf: Record<Outcome, ParentState> = {
  passed: "accepted",
  failed: "rejected",
  broken: "broken",
  "starts passed": "accepted",
};

/** The parent as plain data: one state, the time the child finishes, and the outputs so far. `retry` restarts the child wait, `hurry` ends it now as if it passed or failed. */
function reference(options: CheckOptions) {
  let current: ParentState = "idle";
  let now = 0;
  let finishesAt = 0;
  let outputs = 0;
  const timed = options.outcome !== "starts passed";
  function end(): void {
    current = endingOf[options.outcome];
    if (options.outcome === "passed" || options.outcome === "failed") outputs += 1;
  }
  function endNow(): void {
    current = options.outcome === "failed" ? "rejected" : "accepted";
    outputs += 1;
  }
  return {
    step(step: Step): void {
      switch (step.kind) {
        case "start":
          if (current === "checking") return;
          current = "checking";
          finishesAt = now + options.waitMs;
          if (!timed) end();
          return;
        case "cancel":
          if (current === "checking") current = "idle";
          return;
        case "retry":
          if (current === "checking") finishesAt = now + options.waitMs;
          return;
        case "hurry":
          if (current === "checking") endNow();
          return;
        case "advance":
          now += step.ms;
          if (current === "checking" && now >= finishesAt) end();
          return;
        default:
          return step satisfies never;
      }
    },
    view() {
      const progressEvents = Array.from({ length: outputs }, () => ({ type: "progress" }));
      return { state: current, pending: current === "checking", outputs: progressEvents };
    },
  };
}

describe("embed property tests", () => {
  test("the parent matches a one-state model: forwarded inputs move the child, it ends once, leaves no timers, leaks no mapped event", () => {
    runProperty(anyRun, ({ steps, ...options }) => {
      const { actor, clock, outputs, drive } = parentOf(options);
      const model = reference(options);
      const seen: unknown[] = [];
      const expected: Array<ReturnType<typeof model.view>> = [];
      for (const step of steps) {
        model.step(step);
        drive(step);
        expected.push(model.view());
        seen.push({ state: actor.state.name, pending: clock.hasPending(), outputs: [...outputs] });
      }
      expect(seen).toEqual(expected);
    });
  });
});
