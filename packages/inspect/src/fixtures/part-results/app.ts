/** A shop whose factory returns a store next to the root. No handler for the store's events lives in this file. */
import { Actor, event, machine, state } from "@mantaq/core";
import { makeStore } from "./store.ts";

/** The shop is open. */
const open = state("open")();
/** Someone looked around. */
const looked = event("LOOKED")();

export const shop = machine("shop", {
  create: ({ clock }) => {
    const root = Actor({
      clock,
      inputs: [looked],
      states: [open],
      initial: open,
      setup: (m) => {
        /** Looking around changes nothing. */
        m.on(open, { event: looked, handler: () => ({}) });
      },
    });
    return { actor: root, store: makeStore(clock) };
  },
});
