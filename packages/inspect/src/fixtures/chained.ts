/**
 * Two timers in a row: one advance of the clock walks `first` to `second` to
 * `last`, so `second` is only visible while the step is still running.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import { withTimeout } from "@mantaq/sugar";

const idle = state("idle")();
const first = state("first")();
const second = state("second")();
const last = state("last")();
const start = event("start")();
const tick = event("tick")();

export function createChainedActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: { phase: number } = { phase: 0 };
  return Actor({
    inputs: [start],
    internal: [tick],
    states: [idle, first, second, last],
    initial: idle,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(idle, { event: start, to: [first], handler: () => ({ state: first }) });
      m.effect(first, {
        name: "wait",
        sends: [tick],
        fn: (input) => withTimeout(100, { input, event: () => tick.create() }),
      });
      m.effect(second, {
        name: "wait",
        sends: [tick],
        fn: (input) => withTimeout(100, { input, event: () => tick.create() }),
      });
      m.on(first, {
        event: tick,
        to: [second],
        handler: (_event, { context }) => {
          context.set({ phase: 1 });
          return { state: second };
        },
      });
      m.on(second, {
        event: tick,
        to: [last],
        handler: (_event, { context }) => {
          context.set({ phase: 2 });
          return { state: last };
        },
      });
    },
  });
}
