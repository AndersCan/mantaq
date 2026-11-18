import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const a = state("a")();
const b = state("b")();
const c = state("c")();
const home = state("home")();
const begin = event("begin")();
const next = event("next")();
const go = event("go")();

/** a, b and c each leave on `go` to home: drawn once, from a node naming them. */
export const sharedGo = machine("sharedGo", {
  create: ({ clock }) =>
    Actor({
      clock,
      inputs: [begin, next, go],
      states: [idle, a, b, c, home],
      initial: idle,
      setup: (m) => {
        m.on(idle, { event: begin, to: [a], handler: () => ({ state: a }) });
        m.on(a, { event: next, to: [b], handler: () => ({ state: b }) });
        m.on(a, { event: go, to: [home], handler: () => ({ state: home }) });
        m.on(b, { event: go, to: [home], handler: () => ({ state: home }) });
        m.on(c, { event: go, to: [home], handler: () => ({ state: home }) });
      },
    }),
});
