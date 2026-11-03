/** A factory with an 800 ms deadline: `start` waits, the timer sends `expired`, which ends in `error`. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

const idle = state("idle")();
const waiting = state("waiting")();
const error = state("error")();
const start = event("start")();
const expired = event("expired")();

export function createTimedActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
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
  });
}
