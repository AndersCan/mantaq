/** Leading JSDoc on states, events and handlers; some declarations stay bare. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/**
 * Waiting for the visitor.
 * Shows the welcome screen.
 */
const waiting = state("waiting")();
const done = state("done")();
const idle = state("idle")();

/** The visitor pressed start. */
const start = event("start")();
const finish = event("finish")();
const again = event("again")();
const more = event("more")();
const last = event("last")();

export function createDocumentedActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [start, finish, again, more, last],
    states: [waiting, done, idle],
    initial: waiting,
    clock,
    setup: (m) => {
      /**
       * Starting moves on.
       *
       * Nothing is saved yet.
       */
      m.on(waiting, { event: start, to: [done], handler: () => ({ state: done }) });
      /** Greets the visitor. */
      m.effect(waiting, { name: "greet", fn: () => undefined });
      /** Plays a chime. */
      m.effect(waiting, { name: "chime", fn: () => undefined });
      m.effect(done, { name: "tidy", fn: () => undefined });
      /** Counts the hours. */
      m.effect(idle, { name: "tick", fn: () => undefined })
        /** Rings the bell. */
        .effect(idle, { name: "bell", fn: () => undefined });
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
