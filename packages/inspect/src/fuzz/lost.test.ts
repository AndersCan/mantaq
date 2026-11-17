import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { VizStep } from "@mantaq/viz";
import { onOutput, withTimeout } from "@mantaq/sugar";
import { expect, test } from "vite-plus/test";
import { inspect } from "../inspect.ts";
import { execute } from "./run.ts";

const browsing = state("browsing")();
const waiting = state("waiting")();
const gaveUp = state("gaveUp")();
const payClicked = event("PAY_CLICKED")();
const waitedTooLong = event("WAITED_TOO_LONG")();
const timedOut = event("PAYMENT_TIMED_OUT")();

const ready = state("ready")();
const busy = state("busy")();
const started = event("PAYMENT_STARTED")();
const strayed = event("STRAY")();

function create(options: { receiver: "none" | "busy-only" | "any"; stray?: true }) {
  const clock = VirtualClock();
  const checkout = Actor({
    inputs: [payClicked],
    internal: [waitedTooLong],
    outputs: [timedOut],
    states: [browsing, waiting, gaveUp],
    initial: browsing,
    clock,
    setup: (m) => {
      m.on(browsing, { event: payClicked, to: [waiting], handler: () => ({ state: waiting }) });
      m.effect(waiting, {
        name: "deadline",
        sends: [waitedTooLong],
        fn: (input) => withTimeout(30_000, { input, event: () => waitedTooLong.create() }),
      });
      m.on(waiting, {
        event: waitedTooLong,
        to: [gaveUp],
        handler: () => ({ state: gaveUp, emit: [timedOut.create()] }),
      });
    },
  });
  const payment = Actor({
    inputs: [started, timedOut],
    states: [ready, busy],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, { event: started, to: [busy], handler: () => ({ state: busy }) });
      if (options.receiver === "busy-only") {
        m.on(busy, { event: timedOut, to: [ready], handler: () => ({ state: ready }) });
      }
      if (options.receiver === "any") {
        m.onAny({ event: timedOut, to: [ready], handler: () => ({ state: ready }) });
      }
    },
  });
  if (options.stray) {
    clock.setTimeout(40_000, {
      signal: new AbortController().signal,
      cb: () => payment.send(strayed.create() as never),
    });
  }
  onOutput(checkout, (out) => payment.send(out as never));
  return { actor: checkout, payment, clock };
}

const pay: VizStep = { kind: "event", event: "PAY_CLICKED", payload: null };
const injected: VizStep = { kind: "event", event: "WAITED_TOO_LONG", payload: null };
const advance: VizStep = { kind: "advance", ms: 30_000 };

const withMade = (created: ReturnType<typeof create>) => ({
  actor: created.actor,
  clock: created.clock,
  made: created,
});

const lostOf = (receiver: "none" | "busy-only" | "any", steps: VizStep[]) =>
  execute({ id: "checkout", create: () => withMade(create({ receiver })) }, steps).lost;

test("an injected internal event whose output the receiver handles nowhere is a lost message", () => {
  expect(lostOf("none", [pay, injected])).toEqual([
    { sender: "checkout", receiver: "payment", event: "PAYMENT_TIMED_OUT", step: 1 },
  ]);
});

test("a timer-driven output is a lost message from the machine that ran the timer", () => {
  expect(lostOf("none", [pay, advance])).toEqual([
    { sender: "checkout", receiver: "payment", event: "PAYMENT_TIMED_OUT", step: 1 },
  ]);
});

test("a receiver that handles the event in another state loses nothing", () => {
  expect(lostOf("busy-only", [pay, injected])).toEqual([]);
});

test("a receiver that handles the event in onAny loses nothing", () => {
  expect(lostOf("any", [pay, injected])).toEqual([]);
});

test("the fuzzer's own step to a machine that handles it nowhere is not a message", () => {
  const step: VizStep = {
    kind: "event",
    event: "PAYMENT_TIMED_OUT",
    payload: null,
    actor: { region: "payment" },
  };
  expect(lostOf("none", [step])).toEqual([]);
});

test("a send from a timer that no machine moved for is not noted", () => {
  const target = {
    id: "checkout",
    create: () => withMade(create({ receiver: "none", stray: true })),
  };
  const late: VizStep = { kind: "advance", ms: 10_000 };
  expect(execute(target, [{ kind: "advance", ms: 40_000 }]).lost).toEqual([]);
  // The timeout at 30 s moved checkout in the step before; the stray send is a later step's.
  const lost = execute(target, [pay, advance, late]).lost;
  expect(lost.map((each) => each.event)).toEqual(["PAYMENT_TIMED_OUT"]);
});

test("a repeated lost send is noted once", () => {
  expect(lostOf("none", [pay, injected, pay, injected])).toHaveLength(1);
});

test("inspect returns the lost message with steps that replay from a fresh actor", () => {
  const target = { id: "checkout", create: () => create({ receiver: "none" }) };
  const { lostMessages } = inspect(target);
  expect(lostMessages).toHaveLength(1);
  const [found] = lostMessages;
  expect(found).toMatchObject({
    sender: "checkout",
    receiver: "payment",
    event: "PAYMENT_TIMED_OUT",
  });
  const fuzzTarget = { id: target.id, create: () => withMade(target.create()) };
  expect(execute(fuzzTarget, found?.steps ?? []).lost).toHaveLength(1);
});

test("inspect returns no lost message when the receiver handles it", () => {
  const { lostMessages } = inspect({ id: "checkout", create: () => create({ receiver: "any" }) });
  expect(lostMessages).toEqual([]);
});
