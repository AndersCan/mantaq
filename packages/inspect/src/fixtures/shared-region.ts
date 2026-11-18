import { Actor, event, machine, state } from "@mantaq/core";

/** The screen. */
const screen = state("screen")();
/** a. */
const a = state("a")();
/** b. */
const b = state("b")();
/** c. */
const c = state("c")();
/** d. */
const d = state("d")();
/** Next. */
const next = event("next")();
/** Stop. */
const stop = event("stop")();

export const sharedRegion = machine("sharedRegion", {
  create: ({ clock }) => {
    const steps = Actor({
      clock,
      inputs: [next, stop],
      states: [a, b, c, d],
      initial: a,
      setup: (m) => {
        m.on(a, { event: next, to: [b], handler: () => ({ state: b }) });
        m.on(b, { event: next, to: [c], handler: () => ({ state: c }) });
        m.on(a, { event: stop, to: [d], handler: () => ({ state: d }) });
        m.on(b, { event: stop, to: [d], handler: () => ({ state: d }) });
        m.on(c, { event: stop, to: [d], handler: () => ({ state: d }) });
      },
    });
    return Actor({
      clock,
      inputs: [],
      states: [screen],
      initial: screen,
      regions: { steps },
      setup: () => {},
    });
  },
});
