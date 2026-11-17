/** Machines exported as `machine(id, { create })` values: one timed, one with a port, one that ignores its clock. */
import { Actor, VirtualClock, event, machine, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

const idle = state("idle")();
const waiting = state("waiting")();
const error = state("error")().final();
const start = event("start")();
const expired = event("expired")();

/** Waits 800 ms after `start`, then fails. */
export const deadline = machine("deadline", {
  create: ({ clock }) =>
    Actor({
      inputs: [start],
      internal: [expired],
      states: [idle, waiting, error],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: start, to: [waiting], handler: () => ({ state: waiting }) });
        m.effect(waiting, {
          name: "deadline",
          sends: [expired],
          fn: (input) => withTimeout(800, { input, event: () => expired.create() }),
        });
        m.on(waiting, { event: expired, to: [error], handler: () => ({ state: error }) });
      },
    }),
});

const sleeping = state("sleeping")();
const awake = state("awake")().final();
const wake = event("wake")();

/** Has no timer: it never mentions a clock, and takes a port with a default. */
export const sleeper = machine("sleeper", {
  create: ({ greet = () => "hi" }: { greet?: () => string }) =>
    Actor({
      inputs: [wake],
      states: [sleeping, awake],
      initial: sleeping,
      context: { greeting: greet() },
      setup: (m) => {
        m.on(sleeping, { event: wake, to: [awake], handler: () => ({ state: awake }) });
      },
    }),
});

/** Builds its actor on a VirtualClock of its own, so nobody else can move its time. */
export const stubborn = machine("stubborn", {
  create: () =>
    Actor({
      inputs: [wake],
      states: [sleeping, awake],
      initial: sleeping,
      clock: VirtualClock(),
      setup: (m) => {
        m.on(sleeping, { event: wake, to: [awake], handler: () => ({ state: awake }) });
      },
    }),
});
