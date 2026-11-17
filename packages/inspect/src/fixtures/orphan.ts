import { Actor, event, machine, state } from "@mantaq/core";

/** Nothing is running. */
const idle = state("idle")();
/** Work is in progress. */
const running = state("running")();
/** A state nothing leads to. */
const orphanState = state("orphan")();
/** Work was started. */
const go = event("go")();

export const orphan = machine("orphan", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [go],
      states: [idle, running, orphanState],
      initial: idle,
      setup: (m) => {
        /** The runner starts running. */
        m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
        /** The runner goes idle again. */
        m.on(running, { event: go, to: [idle], handler: () => ({ state: idle }) });
      },
    });
  },
});
