/** Leading JSDoc on states, events and handlers; some declarations stay bare. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/**
 * Waiting for the visitor.
 * Shows the welcome screen.
 */
const waiting = state("waiting")();
const done = state("done")();

/** The visitor pressed start. */
const start = event("start")();
const finish = event("finish")();
const again = event("again")();
const more = event("more")();
const last = event("last")();

export function createDocumentedActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [start, finish, again, more, last],
    states: [waiting, done],
    initial: waiting,
    clock,
    setup: (m) => {
      /**
       * Starting moves on.
       *
       * Nothing is saved yet.
       */
      m.on(waiting, { event: start, to: [done], handler: () => ({ state: done }) });
      m.onAny({ event: finish, to: [done], handler: () => ({ state: done }) });
      /** First of the chain, see {@link waiting}. */
      m.on(done, { event: again, to: [waiting], handler: () => ({ state: waiting }) })
        /**
         * Second of the chain.
         * @param event ignored
         */
        .on(done, { event: more, to: [waiting], handler: () => ({ state: waiting }) })
        .on(done, { event: last, to: [waiting], handler: () => ({ state: waiting }) });
    },
  });
}
