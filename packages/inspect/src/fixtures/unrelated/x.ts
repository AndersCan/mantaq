import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** A name the root shows; the root never runs this actor. */
export const helperName = "x";

export function xActor() {
  return Actor({
    inputs: [go],
    internal: [],
    states: [idle, done],
    initial: idle,
    setup: (m) => {
      /** X finishes at once. */
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
    },
  });
}
