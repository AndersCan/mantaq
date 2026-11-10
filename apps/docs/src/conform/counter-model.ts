import { Actor, event, state } from "@mantaq/core";

const MAX = 3;

/** Nothing counted yet. */
const empty = state("empty")();
/** Between zero and the maximum. */
const counting = state("counting")();
/** The counter stopped at the maximum. */
const full = state("full")();

/** Add one, unless the counter is full. */
const increment = event("increment")();
/** Subtract one, unless the counter is empty. */
const decrement = event("decrement")();
/** Back to zero from any state. */
const reset = event("reset")();

export function createCounterModel() {
  return Actor({
    inputs: [increment, decrement, reset],
    states: [empty, counting, full],
    initial: empty,
    context: { count: 0 },
    setup: (m) => {
      m.on(empty, {
        event: increment,
        to: [counting],
        handler: (_event, { context }) => {
          context.set({ count: 1 });
          return { state: counting };
        },
      });
      m.on(counting, {
        event: increment,
        to: [counting, full],
        handler: (_event, { context }) => {
          const count = context.get().count + 1;
          context.set({ count });
          return { state: count >= MAX ? full : counting };
        },
      });
      m.on(counting, {
        event: decrement,
        to: [empty, counting],
        handler: (_event, { context }) => {
          const count = context.get().count - 1;
          context.set({ count });
          return { state: count === 0 ? empty : counting };
        },
      });
      m.on(full, {
        event: decrement,
        to: [counting],
        handler: (_event, { context }) => {
          context.set({ count: context.get().count - 1 });
          return { state: counting };
        },
      });
      m.onAny({
        event: reset,
        to: [empty],
        handler: (_event, { context }) => {
          context.set({ count: 0 });
          return { state: empty };
        },
      });
    },
  });
}
