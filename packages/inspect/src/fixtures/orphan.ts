import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Nothing is running. */
const idle = state("idle")();
/** Work is in progress. */
const running = state("running")();
/** A state nothing leads to. */
const orphan = state("orphan")();
/** Work was started. */
const go = event("go")();

export function createOrphanActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [go],
    states: [idle, running, orphan],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: go, to: [running], handler: () => ({ state: running }) });
      m.on(running, { event: go, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}
